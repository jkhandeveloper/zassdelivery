import { Injectable } from '@nestjs/common';
import {
  ActorType,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  Prisma,
  TransactionStatus,
  TransactionType,
  WalletTransactionReason,
  WalletTransactionType,
  type Transaction,
} from '@prisma/client';

import { BusinessRuleViolationException } from '@/common/exceptions/domain.exception';
import type { PaginatedResult } from '@/common/interfaces/paginated-result.interface';
import { paginate } from '@/common/utils/pagination.util';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';

import {
  PaymentRepository,
  type CreateAttemptInput,
  type FailInput,
  type LedgerTotal,
  type ListPaymentsFilter,
  type ListTransactionsFilter,
  type PaymentWithContext,
  type RecordRefundInput,
  type SettleInput,
} from '../../domain/repositories/payment.repository';
import { OPEN_STATUSES, PaymentStateMachine } from '../../domain/services/payment-state';

const CONTEXT = {
  order: {
    select: {
      id: true,
      orderNumber: true,
      status: true,
      customerId: true,
      restaurantId: true,
      totalAmount: true,
      paymentStatus: true,
    },
  },
  user: { select: { id: true, fullName: true, phone: true, email: true } },
} satisfies Prisma.PaymentInclude;

@Injectable()
export class PrismaPaymentRepository extends PaymentRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async findMany(filter: ListPaymentsFilter): Promise<PaginatedResult<PaymentWithContext>> {
    const where: Prisma.PaymentWhereInput = {
      ...(filter.userId && { userId: filter.userId }),
      ...(filter.orderId && { orderId: filter.orderId }),
      ...(filter.status && { status: filter.status }),
      ...(filter.method && { method: filter.method }),
      ...(filter.gatewayName && { gatewayName: filter.gatewayName }),
      ...(filter.search && {
        OR: [
          { reference: { contains: filter.search, mode: 'insensitive' } },
          { gatewayTransactionId: { contains: filter.search, mode: 'insensitive' } },
          { order: { orderNumber: { contains: filter.search, mode: 'insensitive' } } },
        ],
      }),
      ...((filter.from || filter.to) && {
        createdAt: {
          ...(filter.from && { gte: filter.from }),
          ...(filter.to && { lte: filter.to }),
        },
      }),
    };

    const [total, items] = await this.prisma.$transaction([
      this.prisma.payment.count({ where }),
      this.prisma.payment.findMany({
        where,
        include: CONTEXT,
        orderBy: filter.orderBy,
        skip: (filter.page - 1) * filter.limit,
        take: filter.limit,
      }),
    ]);

    return paginate(items, total, filter.page, filter.limit);
  }

  async findById(id: string): Promise<PaymentWithContext | null> {
    return this.prisma.payment.findUnique({ where: { id }, include: CONTEXT });
  }

  async findByReference(reference: string): Promise<PaymentWithContext | null> {
    return this.prisma.payment.findUnique({ where: { reference }, include: CONTEXT });
  }

  async findOpenForOrder(orderId: string): Promise<PaymentWithContext | null> {
    return this.prisma.payment.findFirst({
      where: { orderId, status: { in: OPEN_STATUSES } },
      include: CONTEXT,
      orderBy: { createdAt: 'desc' },
    });
  }

  async createAttempt(input: CreateAttemptInput): Promise<PaymentWithContext> {
    return this.prisma.$transaction(async (tx) => {
      const reference = await this.nextReference(tx);

      return tx.payment.create({
        data: {
          orderId: input.orderId,
          userId: input.userId,
          method: input.method,
          amount: input.amount,
          reference,
          gatewayName: input.gatewayName,
          expiresAt: input.expiresAt,
          status: PaymentStatus.PENDING,
        },
        include: CONTEXT,
      });
    });
  }

  async settle(input: SettleInput): Promise<PaymentWithContext> {
    // Everything a successful payment implies lands together: the attempt, the
    // order it unblocks, the ledger entry and the commission. A payment that is
    // PAID against an order still sitting in PENDING_PAYMENT is the single
    // worst state this module could produce — the customer has been charged and
    // the kitchen has been told nothing.
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.payment.findUniqueOrThrow({
        where: { id: input.paymentId },
        include: { order: true },
      });

      // Idempotent: a webhook and a browser return describing the same success
      // both arrive, routinely, within a second of each other.
      if (PaymentStateMachine.isSettled(current.status)) {
        return tx.payment.findUniqueOrThrow({ where: { id: input.paymentId }, include: CONTEXT });
      }

      PaymentStateMachine.assertTransition(current.status, input.status);

      const settledNow = input.status === PaymentStatus.PAID;

      await tx.payment.update({
        where: { id: input.paymentId },
        data: {
          status: input.status,
          gatewayTransactionId: input.gatewayTransactionId,
          gatewayResponse: input.gatewayResponse ?? undefined,
          paidAt: settledNow ? new Date() : null,
          failureReason: null,
        },
      });

      if (!settledNow) {
        // Authorised money is ring-fenced, not received; nothing downstream
        // moves until it is captured.
        return tx.payment.findUniqueOrThrow({ where: { id: input.paymentId }, include: CONTEXT });
      }

      await tx.order.update({
        where: { id: current.orderId },
        data: { paymentStatus: PaymentStatus.PAID },
      });

      // An order held for payment is released the moment the money lands. This
      // is the transition that puts the ticket in front of the restaurant.
      if (current.order.status === OrderStatus.PENDING_PAYMENT) {
        await tx.order.update({
          where: { id: current.orderId },
          data: { status: OrderStatus.PLACED, placedAt: new Date() },
        });

        await tx.orderStatusHistory.create({
          data: {
            orderId: current.orderId,
            fromStatus: OrderStatus.PENDING_PAYMENT,
            toStatus: OrderStatus.PLACED,
            actor: ActorType.SYSTEM,
            note: `Payment received via ${current.gatewayName ?? current.method}`,
          },
        });
      }

      await tx.transaction.create({
        data: {
          paymentId: current.id,
          orderId: current.orderId,
          userId: current.userId,
          type: TransactionType.PAYMENT,
          status: TransactionStatus.SUCCESS,
          amount: current.amount,
          // The payment reference is unique, so this is also the idempotency
          // key that makes a replayed settlement a no-op at the database level.
          reference: `TXN-${current.reference ?? current.id}-PAYMENT`,
          description: `Paid via ${current.gatewayName ?? current.method}`,
          processedAt: new Date(),
        },
      });

      // Commission was posted as PENDING when the order was placed; the money
      // arriving is what confirms it.
      await tx.transaction.updateMany({
        where: {
          orderId: current.orderId,
          type: TransactionType.COMMISSION,
          status: TransactionStatus.PENDING,
        },
        data: { status: TransactionStatus.SUCCESS, processedAt: new Date() },
      });

      return tx.payment.findUniqueOrThrow({ where: { id: input.paymentId }, include: CONTEXT });
    });
  }

  async fail(input: FailInput): Promise<PaymentWithContext> {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.payment.findUniqueOrThrow({
        where: { id: input.paymentId },
        include: { order: { include: { items: true } } },
      });

      if (PaymentStateMachine.isSettled(current.status)) {
        throw new BusinessRuleViolationException(
          'This payment has already been collected and cannot be marked failed. Refund it instead.',
        );
      }

      if (PaymentStateMachine.isTerminal(current.status)) {
        return tx.payment.findUniqueOrThrow({ where: { id: input.paymentId }, include: CONTEXT });
      }

      await tx.payment.update({
        where: { id: input.paymentId },
        data: {
          status: input.status,
          failureReason: input.reason,
          failedAt: new Date(),
          gatewayResponse: input.gatewayResponse ?? undefined,
        },
      });

      if (!input.failOrder) {
        // The customer can try again — a declined card is not a dead order.
        return tx.payment.findUniqueOrThrow({ where: { id: input.paymentId }, include: CONTEXT });
      }

      if (current.order.status === OrderStatus.PENDING_PAYMENT) {
        await tx.order.update({
          where: { id: current.orderId },
          data: {
            status: OrderStatus.FAILED,
            paymentStatus: PaymentStatus.FAILED,
            cancelledAt: new Date(),
            cancelledBy: ActorType.SYSTEM,
            cancellationReason: input.reason,
          },
        });

        await tx.orderStatusHistory.create({
          data: {
            orderId: current.orderId,
            fromStatus: OrderStatus.PENDING_PAYMENT,
            toStatus: OrderStatus.FAILED,
            actor: ActorType.SYSTEM,
            note: input.reason,
          },
        });

        // Checkout claimed this stock while the customer was paying. Nobody
        // paid, so it goes back — held stock is stock the next customer could
        // not buy.
        for (const line of current.order.items) {
          if (line.menuItemId === null) {
            continue;
          }

          await tx.menuItem.updateMany({
            where: { id: line.menuItemId, trackInventory: true },
            data: { stockQuantity: { increment: line.quantity } },
          });
        }
      }

      return tx.payment.findUniqueOrThrow({ where: { id: input.paymentId }, include: CONTEXT });
    });
  }

  async settleCash(paymentId: string, actorId: string): Promise<PaymentWithContext> {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.payment.findUniqueOrThrow({ where: { id: paymentId } });

      if (current.method !== PaymentMethod.CASH_ON_DELIVERY) {
        throw new BusinessRuleViolationException('This is not a cash-on-delivery payment.');
      }

      if (PaymentStateMachine.isSettled(current.status)) {
        return tx.payment.findUniqueOrThrow({ where: { id: paymentId }, include: CONTEXT });
      }

      PaymentStateMachine.assertTransition(current.status, PaymentStatus.PAID);

      await tx.payment.update({
        where: { id: paymentId },
        data: { status: PaymentStatus.PAID, paidAt: new Date() },
      });

      await tx.order.update({
        where: { id: current.orderId },
        data: { paymentStatus: PaymentStatus.PAID },
      });

      await tx.transaction.create({
        data: {
          paymentId: current.id,
          orderId: current.orderId,
          userId: current.userId,
          type: TransactionType.PAYMENT,
          status: TransactionStatus.SUCCESS,
          amount: current.amount,
          reference: `TXN-${current.reference ?? current.id}-CASH`,
          description: 'Cash collected on delivery',
          metadata: { recordedBy: actorId },
          processedAt: new Date(),
        },
      });

      await tx.transaction.updateMany({
        where: {
          orderId: current.orderId,
          type: TransactionType.COMMISSION,
          status: TransactionStatus.PENDING,
        },
        data: { status: TransactionStatus.SUCCESS, processedAt: new Date() },
      });

      return tx.payment.findUniqueOrThrow({ where: { id: paymentId }, include: CONTEXT });
    });
  }

  async totalRefunded(paymentId: string): Promise<number> {
    const result = await this.prisma.transaction.aggregate({
      where: {
        paymentId,
        type: TransactionType.REFUND,
        // A refund the gateway is still processing is money already promised;
        // counting only settled ones would let it be promised twice.
        status: { in: [TransactionStatus.SUCCESS, TransactionStatus.PENDING] },
      },
      _sum: { amount: true },
    });

    return Number(result._sum.amount ?? 0);
  }

  async recordRefund(input: RecordRefundInput): Promise<Transaction> {
    return this.prisma.$transaction(async (tx) => {
      const payment = await tx.payment.findUniqueOrThrow({ where: { id: input.paymentId } });

      await tx.payment.update({
        where: { id: input.paymentId },
        data: { refundedAmount: { increment: input.amount } },
      });

      const refundedInTotal = Number(payment.refundedAmount) + input.amount;
      const status = PaymentStateMachine.statusAfterRefund(Number(payment.amount), refundedInTotal);

      await tx.payment.update({ where: { id: input.paymentId }, data: { status } });
      await tx.order.update({
        where: { id: input.orderId },
        data: { paymentStatus: status },
      });

      // A refund to our own wallet is money the customer can spend immediately,
      // so it moves here. A refund to the gateway moves on the provider's
      // timetable and only the ledger entry is written.
      if (input.destination === 'WALLET') {
        const wallet = await tx.wallet.upsert({
          where: { userId: input.userId },
          update: {},
          create: { userId: input.userId },
        });

        await tx.wallet.update({
          where: { id: wallet.id },
          data: { balance: { increment: input.amount } },
        });

        await tx.walletTransaction.create({
          data: {
            walletId: wallet.id,
            type: WalletTransactionType.CREDIT,
            reason: WalletTransactionReason.ORDER_REFUND,
            amount: input.amount,
            balanceAfter: Number(wallet.balance) + input.amount,
            referenceType: 'payment',
            referenceId: input.paymentId,
            description: `Refund for ${payment.reference ?? input.paymentId}: ${input.reason}`,
          },
        });
      }

      return tx.transaction.create({
        data: {
          paymentId: input.paymentId,
          orderId: input.orderId,
          userId: input.userId,
          type: TransactionType.REFUND,
          status: input.status,
          amount: input.amount,
          // The timestamp keeps partial refunds distinct under the unique
          // constraint that makes replays safe.
          reference: `TXN-${payment.reference ?? input.paymentId}-REFUND-${Date.now()}`,
          description: input.reason,
          metadata: {
            destination: input.destination,
            gatewayRefundId: input.gatewayRefundId,
            issuedBy: input.actorId,
          },
          processedAt: input.status === TransactionStatus.SUCCESS ? new Date() : null,
        },
      });
    });
  }

  async findExpired(now: Date, limit: number): Promise<PaymentWithContext[]> {
    return this.prisma.payment.findMany({
      where: {
        status: { in: OPEN_STATUSES },
        expiresAt: { not: null, lte: now },
        gatewayName: { not: null },
      },
      include: CONTEXT,
      orderBy: { expiresAt: 'asc' },
      take: limit,
    });
  }

  async listTransactions(filter: ListTransactionsFilter): Promise<PaginatedResult<Transaction>> {
    const where: Prisma.TransactionWhereInput = {
      ...(filter.userId && { userId: filter.userId }),
      ...(filter.orderId && { orderId: filter.orderId }),
      ...(filter.paymentId && { paymentId: filter.paymentId }),
      ...(filter.type && { type: filter.type }),
      ...(filter.status && { status: filter.status }),
      ...(filter.search && {
        OR: [
          { reference: { contains: filter.search, mode: 'insensitive' } },
          { description: { contains: filter.search, mode: 'insensitive' } },
        ],
      }),
      ...((filter.from || filter.to) && {
        createdAt: {
          ...(filter.from && { gte: filter.from }),
          ...(filter.to && { lte: filter.to }),
        },
      }),
    };

    const [total, items] = await this.prisma.$transaction([
      this.prisma.transaction.count({ where }),
      this.prisma.transaction.findMany({
        where,
        orderBy: filter.orderBy,
        skip: (filter.page - 1) * filter.limit,
        take: filter.limit,
      }),
    ]);

    return paginate(items, total, filter.page, filter.limit);
  }

  async summariseTransactions(from: Date, to: Date): Promise<LedgerTotal[]> {
    const grouped = await this.prisma.transaction.groupBy({
      by: ['type', 'status'],
      where: { createdAt: { gte: from, lte: to } },
      _sum: { amount: true },
      _count: { _all: true },
    });

    return grouped.map((row) => ({
      type: row.type,
      status: row.status,
      count: row._count._all,
      amount: Number(row._sum.amount ?? 0),
    }));
  }

  /**
   * Builds the next merchant reference, e.g. `PAY-260810-0001`.
   *
   * From a Postgres sequence rather than a row count: two checkouts in the same
   * millisecond would otherwise send the gateway one merchant id for two
   * different payments, and whichever settled second would be reconciled
   * against the wrong order.
   */
  private async nextReference(tx: Prisma.TransactionClient): Promise<string> {
    const [row] = await tx.$queryRaw<Array<{ value: bigint }>>`
      SELECT nextval('payment_reference_seq') AS value
    `;

    const today = new Date();
    const stamp = [
      String(today.getFullYear()).slice(2),
      String(today.getMonth() + 1).padStart(2, '0'),
      String(today.getDate()).padStart(2, '0'),
    ].join('');

    return `PAY-${stamp}-${String(Number(row?.value ?? 1)).padStart(4, '0')}`;
  }
}
