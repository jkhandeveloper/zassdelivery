import { Injectable } from '@nestjs/common';
import {
  AssignmentStatus,
  PaymentMethod,
  PaymentStatus,
  Prisma,
  RiderSettlementDirection,
} from '@prisma/client';

import { BusinessRuleViolationException } from '@/common/exceptions/domain.exception';
import type { PaginatedResult } from '@/common/interfaces/paginated-result.interface';
import { paginate } from '@/common/utils/pagination.util';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';

import {
  RiderFinanceRepository,
  type EarningWithOrder,
  type EarningsSummary,
  type LedgerEntryWithContext,
  type ListEarningsFilter,
  type RecordDeliveryInput,
  type RecordedDelivery,
  type RecordSettlementInput,
  type RestaurantBalance,
  type RiderBalance,
  type SettlementScope,
  type SettlementTotals,
  type SettlementWithContext,
} from '../../domain/repositories/rider-finance.repository';

/** Payment states in which the customer's money has actually moved. */
const SETTLED_PAYMENT_STATUSES: PaymentStatus[] = [
  PaymentStatus.PAID,
  PaymentStatus.PARTIALLY_REFUNDED,
  PaymentStatus.REFUNDED,
];

const LEDGER_CONTEXT = {
  order: { select: { orderNumber: true, paymentMethod: true } },
  restaurant: { select: { name: true } },
  driver: { select: { user: { select: { fullName: true } } } },
} satisfies Prisma.RiderLedgerEntryInclude;

const SETTLEMENT_CONTEXT = {
  restaurant: { select: { name: true } },
  driver: { select: { user: { select: { fullName: true } } } },
  recordedBy: { select: { fullName: true } },
} satisfies Prisma.RiderSettlementInclude;

const round = (value: number): number => Math.round(value * 100) / 100;

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

  async recordDelivery(input: RecordDeliveryInput): Promise<RecordedDelivery> {
    return this.prisma.$transaction(async (tx) => {
      // Idempotent on the order: a retried confirmation — a rider tapping twice
      // on a bad connection — must not count the same delivery again.
      const existing = await tx.riderLedgerEntry.findUnique({ where: { orderId: input.orderId } });

      if (existing !== null) {
        return {
          earned: Number(existing.riderFee),
          collected: Number(existing.collectedAmount),
          net: Number(existing.netAmount),
        };
      }

      if (input.components.length > 0) {
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
      }

      const collected = (await this.riderCollected(tx, input.orderId)) ? input.totalAmount : 0;
      const net = round(collected - input.total);

      await tx.riderLedgerEntry.create({
        data: {
          driverId: input.driverId,
          restaurantId: input.restaurantId,
          orderId: input.orderId,
          collectedAmount: collected,
          riderFee: input.total,
          netAmount: net,
        },
      });

      return { earned: input.total, collected, net };
    });
  }

  /**
   * Whether the customer's money ended up with the rider.
   *
   * Cash on delivery always does. A scan-to-pay transfer does when it went to
   * the rider's own QR, which the payment records as its recipient. Anything
   * else — the restaurant's QR, a gateway — reached the restaurant directly.
   */
  private async riderCollected(tx: Prisma.TransactionClient, orderId: string): Promise<boolean> {
    const paid = await tx.payment.findFirst({
      where: { orderId, status: { in: SETTLED_PAYMENT_STATUSES } },
      orderBy: { createdAt: 'desc' },
      select: { method: true, gatewayResponse: true },
    });

    if (paid === null) {
      return false;
    }

    if (paid.method === PaymentMethod.CASH_ON_DELIVERY) {
      return true;
    }

    const receipt = paid.gatewayResponse;

    return (
      paid.method === PaymentMethod.QR_TRANSFER &&
      typeof receipt === 'object' &&
      receipt !== null &&
      !Array.isArray(receipt) &&
      receipt.recipient === 'RIDER'
    );
  }

  // ── Settlement ───────────────────────────────────────────────

  async balancesForRider(driverId: string): Promise<RestaurantBalance[]> {
    const totals = await this.totals({ driverId });

    const restaurants = await this.prisma.restaurant.findMany({
      where: { id: { in: totals.map((row) => row.restaurantId) } },
      select: { id: true, name: true, phone: true, addressLine: true },
    });
    const byId = new Map(restaurants.map((restaurant) => [restaurant.id, restaurant]));

    return totals.flatMap((row) => {
      const restaurant = byId.get(row.restaurantId);

      return restaurant === undefined ? [] : [{ ...row, restaurant }];
    });
  }

  async balancesForRestaurant(restaurantId: string): Promise<RiderBalance[]> {
    const totals = await this.totals({ restaurantId });

    const drivers = await this.prisma.driver.findMany({
      where: { id: { in: totals.map((row) => row.driverId) } },
      select: {
        id: true,
        paymentQrCodes: true,
        user: { select: { fullName: true, phone: true } },
      },
    });
    const byId = new Map(drivers.map((driver) => [driver.id, driver]));

    return totals.flatMap((row) => {
      const driver = byId.get(row.driverId);

      return driver === undefined
        ? []
        : [
            {
              ...row,
              driver: {
                fullName: driver.user.fullName,
                phone: driver.user.phone,
                paymentQrCodes: driver.paymentQrCodes,
              },
            },
          ];
    });
  }

  /**
   * Sums every rider–restaurant pair in scope.
   *
   * Two grouped aggregates rather than a row scan: a busy pair accumulates
   * hundreds of entries a month, and the balance screen only needs the sums.
   */
  private async totals(
    scope: { driverId?: string; restaurantId?: string },
    client: Prisma.TransactionClient = this.prisma,
  ): Promise<SettlementTotals[]> {
    const where = {
      ...(scope.driverId && { driverId: scope.driverId }),
      ...(scope.restaurantId && { restaurantId: scope.restaurantId }),
    };

    const [entries, settlements] = await Promise.all([
      client.riderLedgerEntry.groupBy({
        by: ['driverId', 'restaurantId'],
        where,
        _sum: { collectedAmount: true, riderFee: true, netAmount: true },
        _count: { _all: true },
        _max: { createdAt: true },
      }),
      client.riderSettlement.groupBy({
        by: ['driverId', 'restaurantId', 'direction'],
        where,
        _sum: { amount: true },
        _max: { createdAt: true },
      }),
    ]);

    const pairs = new Map<string, SettlementTotals & { net: number }>();
    const pair = (driverId: string, restaurantId: string) => {
      const key = `${driverId}:${restaurantId}`;
      let row = pairs.get(key);

      if (row === undefined) {
        row = {
          driverId,
          restaurantId,
          deliveries: 0,
          cashCollected: 0,
          riderFees: 0,
          cashHandedOver: 0,
          feesPaid: 0,
          balance: 0,
          net: 0,
          lastActivityAt: null,
        };
        pairs.set(key, row);
      }

      return row;
    };
    const latest = (a: Date | null, b: Date | null) =>
      a === null || (b !== null && b > a) ? b : a;

    for (const entry of entries) {
      const row = pair(entry.driverId, entry.restaurantId);
      row.deliveries = entry._count._all;
      row.cashCollected = Number(entry._sum.collectedAmount ?? 0);
      row.riderFees = Number(entry._sum.riderFee ?? 0);
      row.net = Number(entry._sum.netAmount ?? 0);
      row.lastActivityAt = latest(row.lastActivityAt, entry._max.createdAt);
    }

    for (const settlement of settlements) {
      const row = pair(settlement.driverId, settlement.restaurantId);
      const amount = Number(settlement._sum.amount ?? 0);

      if (settlement.direction === RiderSettlementDirection.RIDER_TO_RESTAURANT) {
        row.cashHandedOver = amount;
      } else {
        row.feesPaid = amount;
      }

      row.lastActivityAt = latest(row.lastActivityAt, settlement._max.createdAt);
    }

    return [...pairs.values()]
      .map(({ net, ...row }) => ({
        ...row,
        balance: round(net - row.cashHandedOver + row.feesPaid),
      }))
      .sort((a, b) => (b.lastActivityAt?.getTime() ?? 0) - (a.lastActivityAt?.getTime() ?? 0));
  }

  async listLedgerEntries(
    scope: SettlementScope,
  ): Promise<PaginatedResult<LedgerEntryWithContext>> {
    const where: Prisma.RiderLedgerEntryWhereInput = {
      ...(scope.driverId && { driverId: scope.driverId }),
      ...(scope.restaurantId && { restaurantId: scope.restaurantId }),
    };

    const [total, items] = await this.prisma.$transaction([
      this.prisma.riderLedgerEntry.count({ where }),
      this.prisma.riderLedgerEntry.findMany({
        where,
        include: LEDGER_CONTEXT,
        orderBy: { createdAt: 'desc' },
        skip: (scope.page - 1) * scope.limit,
        take: scope.limit,
      }),
    ]);

    return paginate(items, total, scope.page, scope.limit);
  }

  async listSettlements(scope: SettlementScope): Promise<PaginatedResult<SettlementWithContext>> {
    const where: Prisma.RiderSettlementWhereInput = {
      ...(scope.driverId && { driverId: scope.driverId }),
      ...(scope.restaurantId && { restaurantId: scope.restaurantId }),
    };

    const [total, items] = await this.prisma.$transaction([
      this.prisma.riderSettlement.count({ where }),
      this.prisma.riderSettlement.findMany({
        where,
        include: SETTLEMENT_CONTEXT,
        orderBy: { createdAt: 'desc' },
        skip: (scope.page - 1) * scope.limit,
        take: scope.limit,
      }),
    ]);

    return paginate(items, total, scope.page, scope.limit);
  }

  async recordSettlement(input: RecordSettlementInput): Promise<SettlementWithContext> {
    return this.prisma.$transaction(async (tx) => {
      // Serialise every write for this pair. The balance read below decides
      // whether the amount is allowed, and it must not change underneath us.
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtext(${input.driverId}), hashtext(${input.restaurantId}))
      `;

      const [totals] = await this.totals(
        { driverId: input.driverId, restaurantId: input.restaurantId },
        tx,
      );
      const balance = totals?.balance ?? 0;

      const owed =
        input.direction === RiderSettlementDirection.RIDER_TO_RESTAURANT
          ? Math.max(0, balance)
          : Math.max(0, -balance);

      if (owed <= 0) {
        throw new BusinessRuleViolationException(
          input.direction === RiderSettlementDirection.RIDER_TO_RESTAURANT
            ? 'This rider does not owe you anything right now.'
            : 'This business does not owe you anything right now.',
        );
      }

      if (input.amount > owed + 0.001) {
        throw new BusinessRuleViolationException(
          `Only Rs. ${owed} is owed right now. Record that amount or less.`,
        );
      }

      return tx.riderSettlement.create({
        data: {
          driverId: input.driverId,
          restaurantId: input.restaurantId,
          direction: input.direction,
          amount: input.amount,
          note: input.note,
          recordedById: input.recordedById,
        },
        include: SETTLEMENT_CONTEXT,
      });
    });
  }
}
