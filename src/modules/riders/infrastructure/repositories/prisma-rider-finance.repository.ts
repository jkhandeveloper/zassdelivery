import { Injectable } from '@nestjs/common';
import {
  AssignmentStatus,
  PayoutStatus,
  Prisma,
  TransactionStatus,
  TransactionType,
  WalletTransactionReason,
  WalletTransactionType,
  type PayoutRequest,
  type WalletTransaction,
} from '@prisma/client';

import { BusinessRuleViolationException } from '@/common/exceptions/domain.exception';
import type { PaginatedResult } from '@/common/interfaces/paginated-result.interface';
import { paginate } from '@/common/utils/pagination.util';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';

import {
  RiderFinanceRepository,
  type CreditEarningsInput,
  type EarningWithOrder,
  type EarningsSummary,
  type ListEarningsFilter,
  type ListPayoutsFilter,
  type RequestPayoutInput,
  type WalletSnapshot,
} from '../../domain/repositories/rider-finance.repository';

/** Withdrawal states in which the money is still held out of the wallet. */
const HELD_STATUSES: PayoutStatus[] = [PayoutStatus.PENDING, PayoutStatus.APPROVED];

/** Start of the current day in Asia/Karachi, which is where the riders are. */
function startOfDay(now: Date): Date {
  const local = new Date(now);
  local.setHours(0, 0, 0, 0);

  return local;
}

/** Start of the current week, taking Monday as the first working day. */
function startOfWeek(now: Date): Date {
  const start = startOfDay(now);
  const dayOfWeek = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - dayOfWeek);

  return start;
}

function startOfMonth(now: Date): Date {
  const start = startOfDay(now);
  start.setDate(1);

  return start;
}

@Injectable()
export class PrismaRiderFinanceRepository extends RiderFinanceRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async listEarnings(filter: ListEarningsFilter): Promise<PaginatedResult<EarningWithOrder>> {
    const where: Prisma.DriverEarningWhereInput = {
      driverId: filter.driverId,
      ...(filter.type && { type: filter.type }),
      ...((filter.from || filter.to) && {
        earnedAt: {
          ...(filter.from && { gte: filter.from }),
          ...(filter.to && { lte: filter.to }),
        },
      }),
    };

    const [total, items] = await this.prisma.$transaction([
      this.prisma.driverEarning.count({ where }),
      this.prisma.driverEarning.findMany({
        where,
        include: { order: { select: { id: true, orderNumber: true } } },
        orderBy: filter.orderBy,
        skip: (filter.page - 1) * filter.limit,
        take: filter.limit,
      }),
    ]);

    return paginate(items, total, filter.page, filter.limit);
  }

  async summarise(driverId: string, now: Date): Promise<EarningsSummary> {
    const dayStart = startOfDay(now);
    const weekStart = startOfWeek(now);
    const monthStart = startOfMonth(now);

    // One round trip for the whole header. Six sequential queries would be six
    // network hops on a screen the rider opens every time they unlock the app.
    const [
      today,
      thisWeek,
      thisMonth,
      lifetime,
      deliveriesToday,
      deliveriesThisWeek,
      lifetimeRuns,
    ] = await this.prisma.$transaction([
      this.sumEarnings(driverId, dayStart),
      this.sumEarnings(driverId, weekStart),
      this.sumEarnings(driverId, monthStart),
      this.sumEarnings(driverId),
      this.countDeliveries(driverId, dayStart),
      this.countDeliveries(driverId, weekStart),
      this.countDeliveries(driverId),
    ]);

    return {
      today: Number(today._sum.amount ?? 0),
      thisWeek: Number(thisWeek._sum.amount ?? 0),
      thisMonth: Number(thisMonth._sum.amount ?? 0),
      lifetime: Number(lifetime._sum.amount ?? 0),
      deliveriesToday,
      deliveriesThisWeek,
      deliveriesLifetime: lifetimeRuns,
    };
  }

  private sumEarnings(driverId: string, from?: Date) {
    return this.prisma.driverEarning.aggregate({
      where: { driverId, ...(from && { earnedAt: { gte: from } }) },
      _sum: { amount: true },
    });
  }

  private countDeliveries(driverId: string, from?: Date) {
    return this.prisma.deliveryAssignment.count({
      where: {
        driverId,
        status: AssignmentStatus.COMPLETED,
        ...(from && { completedAt: { gte: from } }),
      },
    });
  }

  async creditDeliveryEarnings(input: CreditEarningsInput): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      // Idempotent on the order: a retried confirmation — a rider tapping twice
      // on a bad connection — must not pay for the same delivery again.
      const alreadyPaid = await tx.driverEarning.findFirst({
        where: { orderId: input.orderId, driverId: input.driverId },
        select: { id: true },
      });

      if (alreadyPaid) {
        const existing = await tx.driverEarning.aggregate({
          where: { orderId: input.orderId, driverId: input.driverId },
          _sum: { amount: true },
        });

        return Number(existing._sum.amount ?? 0);
      }

      await tx.driverEarning.createMany({
        data: input.components.map((component) => ({
          driverId: input.driverId,
          orderId: input.orderId,
          assignmentId: input.assignmentId,
          type: component.type,
          amount: component.amount,
          description: component.description,
        })),
      });

      const wallet = await tx.wallet.upsert({
        where: { userId: input.userId },
        update: {},
        create: { userId: input.userId },
      });

      await tx.wallet.update({
        where: { id: wallet.id },
        data: { balance: { increment: input.total } },
      });

      await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          type: WalletTransactionType.CREDIT,
          reason: WalletTransactionReason.DRIVER_EARNING,
          amount: input.total,
          balanceAfter: Number(wallet.balance) + input.total,
          referenceType: 'order',
          referenceId: input.orderId,
          description: `Delivery earnings for ${input.orderNumber}`,
        },
      });

      // The platform's own ledger entry: money leaving the business towards a
      // rider is a payout, and the order ledger should show it as one.
      await tx.transaction.create({
        data: {
          orderId: input.orderId,
          userId: input.userId,
          type: TransactionType.PAYOUT,
          status: TransactionStatus.SUCCESS,
          amount: input.total,
          reference: `TXN-${input.orderNumber}-RIDER-EARNING`,
          description: 'Rider delivery earnings',
          processedAt: new Date(),
        },
      });

      return input.total;
    });
  }

  async walletFor(userId: string): Promise<WalletSnapshot> {
    const wallet = await this.prisma.wallet.upsert({
      where: { userId },
      update: {},
      create: { userId },
    });

    const driver = await this.prisma.driver.findUnique({
      where: { userId },
      select: { id: true },
    });

    const held =
      driver === null
        ? { _sum: { amount: null } }
        : await this.prisma.payoutRequest.aggregate({
            where: { driverId: driver.id, status: { in: HELD_STATUSES } },
            _sum: { amount: true },
          });

    return {
      balance: Number(wallet.balance),
      currency: wallet.currency,
      isLocked: wallet.isLocked,
      pendingWithdrawals: Number(held._sum.amount ?? 0),
    };
  }

  async listWalletTransactions(
    userId: string,
    page: number,
    limit: number,
  ): Promise<PaginatedResult<WalletTransaction>> {
    const wallet = await this.prisma.wallet.findUnique({
      where: { userId },
      select: { id: true },
    });

    if (!wallet) {
      return paginate<WalletTransaction>([], 0, page, limit);
    }

    const where: Prisma.WalletTransactionWhereInput = { walletId: wallet.id };

    const [total, items] = await this.prisma.$transaction([
      this.prisma.walletTransaction.count({ where }),
      this.prisma.walletTransaction.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return paginate(items, total, page, limit);
  }

  async listPayouts(filter: ListPayoutsFilter): Promise<PaginatedResult<PayoutRequest>> {
    const where: Prisma.PayoutRequestWhereInput = {
      ...(filter.driverId && { driverId: filter.driverId }),
      ...(filter.status && { status: filter.status }),
      ...((filter.from || filter.to) && {
        createdAt: {
          ...(filter.from && { gte: filter.from }),
          ...(filter.to && { lte: filter.to }),
        },
      }),
    };

    const [total, items] = await this.prisma.$transaction([
      this.prisma.payoutRequest.count({ where }),
      this.prisma.payoutRequest.findMany({
        where,
        orderBy: filter.orderBy,
        skip: (filter.page - 1) * filter.limit,
        take: filter.limit,
      }),
    ]);

    return paginate(items, total, filter.page, filter.limit);
  }

  async findPayout(id: string): Promise<PayoutRequest | null> {
    return this.prisma.payoutRequest.findUnique({ where: { id } });
  }

  async hasOpenPayout(driverId: string): Promise<boolean> {
    const found = await this.prisma.payoutRequest.findFirst({
      where: { driverId, status: { in: HELD_STATUSES } },
      select: { id: true },
    });

    return found !== null;
  }

  async requestPayout(input: RequestPayoutInput): Promise<PayoutRequest> {
    return this.prisma.$transaction(async (tx) => {
      const wallet = await tx.wallet.findUniqueOrThrow({ where: { userId: input.userId } });

      // Re-read inside the transaction. The balance checked by the use-case was
      // true when it was read; a delivery credited or a request created since
      // then would make it a lie, and this is the read that decides.
      if (wallet.isLocked) {
        throw new BusinessRuleViolationException('This wallet is locked.');
      }

      if (Number(wallet.balance) < input.amount) {
        throw new BusinessRuleViolationException(
          `Only Rs. ${Number(wallet.balance)} is available to withdraw.`,
        );
      }

      await tx.wallet.update({
        where: { id: wallet.id },
        data: { balance: { decrement: input.amount } },
      });

      const reference = await this.nextPayoutReference(tx);

      await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          type: WalletTransactionType.DEBIT,
          reason: WalletTransactionReason.WITHDRAWAL,
          amount: input.amount,
          balanceAfter: Number(wallet.balance) - input.amount,
          referenceType: 'payout_request',
          referenceId: reference,
          description: `Withdrawal request ${reference}`,
        },
      });

      return tx.payoutRequest.create({
        data: {
          reference,
          driverId: input.driverId,
          amount: input.amount,
          method: input.method,
          bankName: input.bankName,
          accountTitle: input.accountTitle,
          accountNumber: input.accountNumber,
        },
      });
    });
  }

  async approvePayout(id: string, reviewerId: string): Promise<PayoutRequest> {
    return this.prisma.payoutRequest.update({
      where: { id },
      data: {
        status: PayoutStatus.APPROVED,
        processedById: reviewerId,
        processedAt: new Date(),
      },
    });
  }

  async markPayoutPaid(
    id: string,
    reviewerId: string,
    paymentReference: string | null,
  ): Promise<PayoutRequest> {
    return this.prisma.$transaction(async (tx) => {
      const payout = await tx.payoutRequest.update({
        where: { id },
        data: {
          status: PayoutStatus.PAID,
          processedById: reviewerId,
          processedAt: new Date(),
          paymentReference,
        },
      });

      const driver = await tx.driver.findUniqueOrThrow({
        where: { id: payout.driverId },
        select: { userId: true },
      });

      // The wallet was debited when the request was made, so nothing moves
      // here. What is recorded is that the money actually reached the rider —
      // the ledger entry a reconciliation works from.
      await tx.transaction.create({
        data: {
          userId: driver.userId,
          type: TransactionType.PAYOUT,
          status: TransactionStatus.SUCCESS,
          amount: payout.amount,
          reference: `TXN-${payout.reference}`,
          description: `Rider withdrawal paid${paymentReference === null ? '' : ` — ${paymentReference}`}`,
          processedAt: new Date(),
        },
      });

      return payout;
    });
  }

  async refundPayout(
    id: string,
    status: PayoutStatus,
    context: { reviewerId: string | null; reason: string },
  ): Promise<PayoutRequest> {
    return this.prisma.$transaction(async (tx) => {
      const payout = await tx.payoutRequest.findUniqueOrThrow({ where: { id } });

      const driver = await tx.driver.findUniqueOrThrow({
        where: { id: payout.driverId },
        select: { userId: true },
      });

      const wallet = await tx.wallet.findUniqueOrThrow({ where: { userId: driver.userId } });

      // The hold goes back. A rejected withdrawal that quietly kept the money
      // would be indistinguishable, from the rider's side, from theft.
      await tx.wallet.update({
        where: { id: wallet.id },
        data: { balance: { increment: payout.amount } },
      });

      await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          type: WalletTransactionType.CREDIT,
          reason: WalletTransactionReason.ADJUSTMENT,
          amount: payout.amount,
          balanceAfter: Number(wallet.balance) + Number(payout.amount),
          referenceType: 'payout_request',
          referenceId: payout.reference,
          description: `${payout.reference} returned: ${context.reason}`,
        },
      });

      return tx.payoutRequest.update({
        where: { id },
        data: {
          status,
          rejectionReason: context.reason,
          processedById: context.reviewerId,
          processedAt: new Date(),
        },
      });
    });
  }

  /**
   * Builds the next withdrawal reference, e.g. `WDR-260809-0001`.
   *
   * From a Postgres sequence rather than a row count, so two requests in the
   * same millisecond cannot compute the same reference and have the unique
   * index reject one of them at random.
   */
  private async nextPayoutReference(tx: Prisma.TransactionClient): Promise<string> {
    const [row] = await tx.$queryRaw<Array<{ value: bigint }>>`
      SELECT nextval('payout_reference_seq') AS value
    `;

    const today = new Date();
    const stamp = [
      String(today.getFullYear()).slice(2),
      String(today.getMonth() + 1).padStart(2, '0'),
      String(today.getDate()).padStart(2, '0'),
    ].join('');

    return `WDR-${stamp}-${String(Number(row?.value ?? 1)).padStart(4, '0')}`;
  }
}
