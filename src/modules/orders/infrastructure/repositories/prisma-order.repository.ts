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
  type OrderStatusHistory,
  type Transaction,
} from '@prisma/client';

import type { PaginatedResult } from '@/common/interfaces/paginated-result.interface';
import { paginate } from '@/common/utils/pagination.util';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';

import {
  OrderRepository,
  type ListOrdersFilter,
  type OrderWithDetails,
  type PlaceOrderInput,
  type RefundInput,
} from '../../domain/repositories/order.repository';

const DETAILS = {
  restaurant: {
    select: {
      id: true,
      name: true,
      slug: true,
      logoUrl: true,
      phone: true,
      addressLine: true,
      latitude: true,
      longitude: true,
    },
  },
  customer: { select: { id: true, fullName: true, phone: true } },
  driver: { select: { id: true, userId: true, user: { select: { fullName: true, phone: true } } } },
  address: true,
  items: { include: { addOns: true }, orderBy: { createdAt: 'asc' } },
  statusHistory: { orderBy: { createdAt: 'asc' } },
  payments: { orderBy: { createdAt: 'desc' } },
  transactions: { orderBy: { createdAt: 'desc' } },
} satisfies Prisma.OrderInclude;

const ACTIVE_STATUSES: OrderStatus[] = [
  OrderStatus.PENDING_PAYMENT,
  OrderStatus.PLACED,
  OrderStatus.CONFIRMED,
  OrderStatus.PREPARING,
  OrderStatus.READY_FOR_PICKUP,
  OrderStatus.PICKED_UP,
  OrderStatus.ON_THE_WAY,
];

/** Methods that send the customer to a gateway before the order is released. */
const ONLINE_METHODS: PaymentMethod[] = [
  PaymentMethod.JAZZCASH,
  PaymentMethod.EASYPAISA,
  PaymentMethod.CARD,
];

/** Timestamp column stamped when an order reaches each status. */
const STATUS_TIMESTAMP: Partial<Record<OrderStatus, keyof Prisma.OrderUpdateInput>> = {
  [OrderStatus.PLACED]: 'placedAt',
  [OrderStatus.CONFIRMED]: 'confirmedAt',
  [OrderStatus.READY_FOR_PICKUP]: 'readyAt',
  [OrderStatus.PICKED_UP]: 'pickedUpAt',
  [OrderStatus.DELIVERED]: 'deliveredAt',
  [OrderStatus.CANCELLED]: 'cancelledAt',
};

@Injectable()
export class PrismaOrderRepository extends OrderRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async findMany(filter: ListOrdersFilter): Promise<PaginatedResult<OrderWithDetails>> {
    const where: Prisma.OrderWhereInput = {
      ...(filter.customerId && { customerId: filter.customerId }),
      ...(filter.restaurantId && { restaurantId: filter.restaurantId }),
      ...(filter.driverId && { driverId: filter.driverId }),
      ...(filter.status && { status: filter.status }),
      ...(filter.paymentStatus && { paymentStatus: filter.paymentStatus }),
      ...(filter.activeOnly === true && { status: { in: ACTIVE_STATUSES } }),
      ...(filter.search && {
        orderNumber: { contains: filter.search, mode: 'insensitive' },
      }),
      ...((filter.from || filter.to) && {
        createdAt: {
          ...(filter.from && { gte: filter.from }),
          ...(filter.to && { lte: filter.to }),
        },
      }),
    };

    const [total, items] = await this.prisma.$transaction([
      this.prisma.order.count({ where }),
      this.prisma.order.findMany({
        where,
        include: DETAILS,
        orderBy: filter.orderBy,
        skip: (filter.page - 1) * filter.limit,
        take: filter.limit,
      }),
    ]);

    return paginate(items, total, filter.page, filter.limit);
  }

  async findById(id: string): Promise<OrderWithDetails | null> {
    return this.prisma.order.findUnique({ where: { id }, include: DETAILS });
  }

  async findByNumber(orderNumber: string): Promise<OrderWithDetails | null> {
    return this.prisma.order.findUnique({ where: { orderNumber }, include: DETAILS });
  }

  async place(input: PlaceOrderInput, cartId: string): Promise<OrderWithDetails> {
    // Everything here must land together. A half-written order — lines but no
    // payment, or stock taken but no order — is worse than a failed checkout,
    // because nobody can tell what the customer actually bought.
    return this.prisma.$transaction(async (tx) => {
      const orderNumber = await this.nextOrderNumber(tx);

      const restaurant = await tx.restaurant.findUniqueOrThrow({
        where: { id: input.restaurantId },
        select: { commissionRate: true },
      });

      // Commission is taken on the food value alone. Charging the kitchen a cut
      // of the delivery fee, service fee or tip would bill it for money it
      // never receives.
      const commissionAmount =
        Math.round(input.totals.subtotal * Number(restaurant.commissionRate)) / 100;

      // Cash on delivery is settled by the rider, so it is recorded as pending
      // until the money is actually collected; the wallet is settled instantly.
      const paidNow = input.paymentMethod === PaymentMethod.WALLET;

      // A gateway order is not an order the kitchen should see yet. It waits in
      // PENDING_PAYMENT until the money lands, and the payments module releases
      // it — sending a ticket to the restaurant for a payment that may never
      // complete is how food gets cooked for nobody.
      const awaitsGateway = ONLINE_METHODS.includes(input.paymentMethod);
      const initialStatus = awaitsGateway ? OrderStatus.PENDING_PAYMENT : OrderStatus.PLACED;

      const order = await tx.order.create({
        data: {
          orderNumber,
          customerId: input.customerId,
          restaurantId: input.restaurantId,
          zoneId: input.zoneId,
          addressId: input.addressId,
          status: initialStatus,
          deliveryLine1: input.delivery.line1,
          deliveryLandmark: input.delivery.landmark,
          deliveryLat: input.delivery.latitude,
          deliveryLng: input.delivery.longitude,
          recipientName: input.delivery.recipientName || null,
          recipientPhone: input.delivery.recipientPhone || null,
          deliveryNotes: input.delivery.notes,
          subtotal: input.totals.subtotal,
          discountAmount: input.totals.discountAmount,
          deliveryFee: input.totals.deliveryFee,
          serviceFee: input.totals.serviceFee,
          taxAmount: input.totals.taxAmount,
          tipAmount: input.totals.tipAmount,
          totalAmount: input.totals.totalAmount,
          commissionAmount,
          couponId: input.couponId,
          couponCode: input.couponCode,
          paymentMethod: input.paymentMethod,
          paymentStatus: paidNow ? PaymentStatus.PAID : PaymentStatus.PENDING,
          distanceKm: input.distanceKm,
          preparationMinutes: input.preparationMinutes,
          estimatedDeliveryAt: input.estimatedDeliveryAt,
          customerNote: input.customerNote,
          // "Placed" means the restaurant has been told, which for a gateway
          // order does not happen until the payment settles.
          placedAt: awaitsGateway ? null : new Date(),
        },
      });

      for (const line of input.lines) {
        const created = await tx.orderItem.create({
          data: {
            orderId: order.id,
            menuItemId: line.menuItemId,
            variantId: line.variantId,
            nameSnapshot: line.nameSnapshot,
            variantNameSnapshot: line.variantNameSnapshot,
            unitPrice: line.unitPrice,
            quantity: line.quantity,
            lineTotal: line.lineTotal,
            notes: line.notes,
          },
        });

        if (line.addOns.length > 0) {
          await tx.orderItemAddOn.createMany({
            data: line.addOns.map((addOn) => ({
              orderItemId: created.id,
              addOnId: addOn.addOnId,
              nameSnapshot: addOn.nameSnapshot,
              price: addOn.price,
              quantity: addOn.quantity,
            })),
          });
        }

        // Stock is taken here, inside the same transaction that creates the
        // order, so two simultaneous checkouts cannot both claim the last unit.
        if (line.tracksInventory) {
          const claimed = await tx.menuItem.updateMany({
            where: { id: line.menuItemId, stockQuantity: { gte: line.quantity } },
            data: { stockQuantity: { decrement: line.quantity } },
          });

          if (claimed.count === 0) {
            throw new Prisma.PrismaClientKnownRequestError(
              `${line.nameSnapshot} sold out while you were checking out.`,
              { code: 'P2034', clientVersion: '6.19.3' },
            );
          }
        }
      }

      await tx.orderStatusHistory.create({
        data: {
          orderId: order.id,
          fromStatus: null,
          toStatus: initialStatus,
          actor: ActorType.CUSTOMER,
          actorUserId: input.customerId,
          note: awaitsGateway ? 'Awaiting payment' : 'Order placed',
        },
      });

      // The gateway attempt itself is opened by the payments module, which owns
      // the merchant reference and the checkout window. Recording a second,
      // referenceless attempt here would leave two rows competing to settle one
      // order.
      const payment = awaitsGateway
        ? null
        : await tx.payment.create({
            data: {
              orderId: order.id,
              userId: input.customerId,
              method: input.paymentMethod,
              status: paidNow ? PaymentStatus.PAID : PaymentStatus.PENDING,
              amount: input.totals.totalAmount,
              paidAt: paidNow ? new Date() : null,
            },
          });

      if (paidNow) {
        // The wallet is debited in the same transaction; a balance check that
        // fails here rolls the whole order back rather than leaving an order
        // nobody paid for.
        const wallet = await tx.wallet.findUniqueOrThrow({
          where: { userId: input.customerId },
        });

        if (Number(wallet.balance) < input.totals.totalAmount) {
          throw new Prisma.PrismaClientKnownRequestError('Insufficient wallet balance.', {
            code: 'P2034',
            clientVersion: '6.19.3',
          });
        }

        await tx.wallet.update({
          where: { id: wallet.id },
          data: { balance: { decrement: input.totals.totalAmount } },
        });

        await tx.walletTransaction.create({
          data: {
            walletId: wallet.id,
            type: WalletTransactionType.DEBIT,
            reason: WalletTransactionReason.ORDER_PAYMENT,
            amount: input.totals.totalAmount,
            balanceAfter: Number(wallet.balance) - input.totals.totalAmount,
            referenceType: 'order',
            referenceId: order.id,
            description: `Payment for ${orderNumber}`,
          },
        });

        await tx.transaction.create({
          data: {
            paymentId: payment?.id ?? null,
            orderId: order.id,
            userId: input.customerId,
            type: TransactionType.PAYMENT,
            status: TransactionStatus.SUCCESS,
            amount: input.totals.totalAmount,
            reference: `TXN-${orderNumber}-PAYMENT`,
            description: 'Paid from wallet',
            processedAt: new Date(),
          },
        });
      }

      await tx.transaction.create({
        data: {
          orderId: order.id,
          type: TransactionType.COMMISSION,
          status: TransactionStatus.PENDING,
          amount: commissionAmount,
          reference: `TXN-${orderNumber}-COMMISSION`,
          description: 'Platform commission withheld from restaurant payout',
        },
      });

      if (input.couponId !== null) {
        await tx.coupon.update({
          where: { id: input.couponId },
          data: { usageCount: { increment: 1 } },
        });

        // The unique constraint on orderId is what stops one order consuming a
        // coupon twice under concurrent requests.
        await tx.couponRedemption.create({
          data: {
            couponId: input.couponId,
            userId: input.customerId,
            orderId: order.id,
            discountAmount: input.totals.discountAmount,
          },
        });
      }

      // The basket has become an order; leaving it behind would let the
      // customer check out the same food twice.
      await tx.cart.delete({ where: { id: cartId } });

      return tx.order.findUniqueOrThrow({ where: { id: order.id }, include: DETAILS });
    });
  }

  async transition(
    orderId: string,
    to: OrderStatus,
    context: {
      actor: ActorType;
      actorUserId: string | null;
      note?: string | null;
      cancellationReason?: string | null;
      restock: boolean;
    },
  ): Promise<OrderWithDetails> {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.order.findUniqueOrThrow({
        where: { id: orderId },
        include: { items: true },
      });

      const data: Prisma.OrderUpdateInput = { status: to };

      const timestampField = STATUS_TIMESTAMP[to];
      if (timestampField) {
        (data as Record<string, unknown>)[timestampField] = new Date();
      }

      if (to === OrderStatus.CANCELLED || to === OrderStatus.REJECTED) {
        data.cancelledBy = context.actor;
        data.cancellationReason = context.cancellationReason ?? null;
        data.cancelledAt = new Date();
      }

      // Cash is collected on the doorstep, so payment is only settled the
      // moment the order is actually delivered.
      if (
        to === OrderStatus.DELIVERED &&
        current.paymentMethod === PaymentMethod.CASH_ON_DELIVERY
      ) {
        data.paymentStatus = PaymentStatus.PAID;

        await tx.payment.updateMany({
          where: { orderId, status: PaymentStatus.PENDING },
          data: { status: PaymentStatus.PAID, paidAt: new Date() },
        });

        await tx.transaction.create({
          data: {
            orderId,
            userId: current.customerId,
            type: TransactionType.PAYMENT,
            status: TransactionStatus.SUCCESS,
            amount: current.totalAmount,
            reference: `TXN-${current.orderNumber}-PAYMENT`,
            description: 'Cash collected on delivery',
            processedAt: new Date(),
          },
        });

        await tx.transaction.updateMany({
          where: { orderId, type: TransactionType.COMMISSION },
          data: { status: TransactionStatus.SUCCESS, processedAt: new Date() },
        });
      }

      if (context.restock) {
        // Only dishes that actually track stock had any taken.
        for (const line of current.items) {
          if (line.menuItemId === null) {
            continue;
          }

          await tx.menuItem.updateMany({
            where: { id: line.menuItemId, trackInventory: true },
            data: { stockQuantity: { increment: line.quantity } },
          });
        }
      }

      await tx.order.update({ where: { id: orderId }, data });

      await tx.orderStatusHistory.create({
        data: {
          orderId,
          fromStatus: current.status,
          toStatus: to,
          actor: context.actor,
          actorUserId: context.actorUserId,
          note: context.note ?? context.cancellationReason ?? null,
        },
      });

      return tx.order.findUniqueOrThrow({ where: { id: orderId }, include: DETAILS });
    });
  }

  async timeline(orderId: string): Promise<OrderStatusHistory[]> {
    return this.prisma.orderStatusHistory.findMany({
      where: { orderId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async transactionsFor(orderId: string): Promise<Transaction[]> {
    return this.prisma.transaction.findMany({
      where: { orderId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async refund(input: RefundInput): Promise<Transaction> {
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUniqueOrThrow({ where: { id: input.orderId } });

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
          referenceType: 'order',
          referenceId: input.orderId,
          description: `Refund for ${order.orderNumber}: ${input.reason}`,
        },
      });

      if (input.paymentId !== null) {
        await tx.payment.update({
          where: { id: input.paymentId },
          data: { refundedAmount: { increment: input.amount } },
        });
      }

      const refundedSoFar = await tx.transaction.aggregate({
        where: { orderId: input.orderId, type: TransactionType.REFUND },
        _sum: { amount: true },
      });

      const totalAfter = Number(refundedSoFar._sum.amount ?? 0) + input.amount;

      await tx.order.update({
        where: { id: input.orderId },
        data: {
          paymentStatus:
            totalAfter >= Number(order.totalAmount)
              ? PaymentStatus.REFUNDED
              : PaymentStatus.PARTIALLY_REFUNDED,
        },
      });

      return tx.transaction.create({
        data: {
          paymentId: input.paymentId,
          orderId: input.orderId,
          userId: input.userId,
          type: TransactionType.REFUND,
          status: TransactionStatus.SUCCESS,
          amount: input.amount,
          // The timestamp keeps the reference unique across partial refunds,
          // which the idempotency constraint on `reference` requires.
          reference: `TXN-${order.orderNumber}-REFUND-${Date.now()}`,
          description: input.reason,
          processedAt: new Date(),
        },
      });
    });
  }

  async totalRefunded(orderId: string): Promise<number> {
    const result = await this.prisma.transaction.aggregate({
      where: { orderId, type: TransactionType.REFUND, status: TransactionStatus.SUCCESS },
      _sum: { amount: true },
    });

    return Number(result._sum.amount ?? 0);
  }

  async countForCustomer(customerId: string): Promise<number> {
    return this.prisma.order.count({ where: { customerId } });
  }

  /**
   * Builds the next human-readable order number, e.g. `ZD-260804-0001`.
   *
   * The counter comes from a Postgres sequence rather than a row count, so two
   * checkouts in the same millisecond cannot compute the same number.
   */
  private async nextOrderNumber(tx: Prisma.TransactionClient): Promise<string> {
    const [row] = await tx.$queryRaw<Array<{ value: bigint }>>`
      SELECT nextval('order_number_seq') AS value
    `;

    const today = new Date();
    const stamp = [
      String(today.getFullYear()).slice(2),
      String(today.getMonth() + 1).padStart(2, '0'),
      String(today.getDate()).padStart(2, '0'),
    ].join('');

    return `ZD-${stamp}-${String(Number(row?.value ?? 1)).padStart(4, '0')}`;
  }
}
