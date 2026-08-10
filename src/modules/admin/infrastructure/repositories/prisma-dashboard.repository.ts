import { Injectable } from '@nestjs/common';
import {
  DriverAvailability,
  DriverStatus,
  OrderStatus,
  PaymentStatus,
  PayoutStatus,
  RestaurantStatus,
  TicketStatus,
  UserRole,
  UserStatus,
  WebhookStatus,
} from '@prisma/client';

import { PrismaService } from '@/infrastructure/prisma/prisma.service';

import {
  DashboardRepository,
  type DashboardOperations,
  type DashboardQueues,
  type DashboardTotals,
  type LeaderboardRow,
  type TimeSeriesPoint,
} from '../../domain/repositories/admin.repository';

/** Orders that have been paid for, or will be. Cancellations are excluded. */
const REVENUE_STATUSES: OrderStatus[] = [
  OrderStatus.PLACED,
  OrderStatus.CONFIRMED,
  OrderStatus.PREPARING,
  OrderStatus.READY_FOR_PICKUP,
  OrderStatus.PICKED_UP,
  OrderStatus.ON_THE_WAY,
  OrderStatus.DELIVERED,
];

const IN_FLIGHT: OrderStatus[] = [
  OrderStatus.PLACED,
  OrderStatus.CONFIRMED,
  OrderStatus.PREPARING,
  OrderStatus.READY_FOR_PICKUP,
  OrderStatus.PICKED_UP,
  OrderStatus.ON_THE_WAY,
];

function startOfDay(now: Date): Date {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);

  return start;
}

function startOfMonth(now: Date): Date {
  const start = startOfDay(now);
  start.setDate(1);

  return start;
}

@Injectable()
export class PrismaDashboardRepository extends DashboardRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async totals(now: Date): Promise<DashboardTotals> {
    const today = startOfDay(now);
    const monthStart = startOfMonth(now);

    // One round trip for the whole header. Eight sequential queries would be
    // eight network hops on the screen an operator leaves open all day.
    const [
      customers,
      riders,
      restaurants,
      ordersToday,
      ordersInFlight,
      revenueToday,
      revenueMonth,
    ] = await this.prisma.$transaction([
      this.prisma.user.count({
        where: { role: UserRole.CUSTOMER, deletedAt: null, status: UserStatus.ACTIVE },
      }),
      this.prisma.driver.count({ where: { status: DriverStatus.ACTIVE, deletedAt: null } }),
      this.prisma.restaurant.count({
        where: { status: RestaurantStatus.ACTIVE, deletedAt: null },
      }),
      this.prisma.order.count({ where: { createdAt: { gte: today } } }),
      this.prisma.order.count({ where: { status: { in: IN_FLIGHT } } }),
      this.prisma.order.aggregate({
        where: { createdAt: { gte: today }, status: { in: REVENUE_STATUSES } },
        _sum: { totalAmount: true },
        _avg: { totalAmount: true },
      }),
      this.prisma.order.aggregate({
        where: { createdAt: { gte: monthStart }, status: { in: REVENUE_STATUSES } },
        _sum: { totalAmount: true },
      }),
    ]);

    return {
      customers,
      riders,
      restaurants,
      ordersToday,
      ordersInFlight,
      revenueToday: Number(revenueToday._sum.totalAmount ?? 0),
      revenueThisMonth: Number(revenueMonth._sum.totalAmount ?? 0),
      averageOrderValue: Math.round(Number(revenueToday._avg.totalAmount ?? 0) * 100) / 100,
    };
  }

  /**
   * Everything waiting on somebody.
   *
   * This is the part of the dashboard that is actually a to-do list: each
   * number is a queue with a screen behind it, which is why they are counted
   * together rather than discovered one page at a time.
   */
  async queues(): Promise<DashboardQueues> {
    const [
      restaurantsAwaitingApproval,
      ridersAwaitingApproval,
      ordersAwaitingRestaurant,
      ordersAwaitingRider,
      openTickets,
      pendingWithdrawals,
      unresolvedWebhooks,
    ] = await this.prisma.$transaction([
      this.prisma.restaurant.count({
        where: { status: RestaurantStatus.PENDING_APPROVAL, deletedAt: null },
      }),
      this.prisma.driver.count({
        where: { status: DriverStatus.PENDING_APPROVAL, deletedAt: null },
      }),
      this.prisma.order.count({ where: { status: OrderStatus.PLACED } }),
      // Cooked or cooking, with nobody to carry it. The number that turns into
      // a cold delivery if it is not watched.
      this.prisma.order.count({
        where: {
          status: {
            in: [OrderStatus.CONFIRMED, OrderStatus.PREPARING, OrderStatus.READY_FOR_PICKUP],
          },
          driverId: null,
        },
      }),
      this.prisma.supportTicket.count({
        where: {
          status: {
            in: [TicketStatus.OPEN, TicketStatus.IN_PROGRESS, TicketStatus.WAITING_ON_CUSTOMER],
          },
        },
      }),
      this.prisma.payoutRequest.count({ where: { status: PayoutStatus.PENDING } }),
      this.prisma.webhookEvent.count({
        where: { status: { in: [WebhookStatus.RECEIVED, WebhookStatus.FAILED] } },
      }),
    ]);

    return {
      restaurantsAwaitingApproval,
      ridersAwaitingApproval,
      ordersAwaitingRestaurant,
      ordersAwaitingRider,
      openTickets,
      pendingWithdrawals,
      unresolvedWebhooks,
    };
  }

  async operations(): Promise<DashboardOperations> {
    const [ridersOnline, ridersOnDelivery, accepting, closed] = await this.prisma.$transaction([
      this.prisma.driver.count({
        where: {
          status: DriverStatus.ACTIVE,
          availability: DriverAvailability.ONLINE,
          deletedAt: null,
        },
      }),
      this.prisma.driver.count({
        where: { availability: DriverAvailability.ON_DELIVERY, deletedAt: null },
      }),
      this.prisma.restaurant.count({
        where: { status: RestaurantStatus.ACTIVE, isAcceptingOrders: true, deletedAt: null },
      }),
      this.prisma.restaurant.count({
        where: { status: RestaurantStatus.ACTIVE, isAcceptingOrders: false, deletedAt: null },
      }),
    ]);

    return {
      ridersOnline,
      ridersOnDelivery,
      restaurantsAcceptingOrders: accepting,
      restaurantsClosed: closed,
    };
  }

  /**
   * Orders and revenue per day.
   *
   * Grouped in SQL rather than in the application: a year of orders is a lot of
   * rows to move across the wire in order to count them, and the database is
   * the thing that already has them indexed by date.
   */
  async dailySeries(from: Date, to: Date): Promise<TimeSeriesPoint[]> {
    const rows = await this.prisma.$queryRaw<
      Array<{ date: Date; orders: bigint; revenue: string | null }>
    >`
      SELECT
        date_trunc('day', "created_at") AS date,
        COUNT(*) AS orders,
        SUM("total_amount") FILTER (WHERE "status" = ANY(${REVENUE_STATUSES}::"order_status"[])) AS revenue
      FROM "orders"
      WHERE "created_at" >= ${from} AND "created_at" <= ${to}
      GROUP BY 1
      ORDER BY 1 ASC
    `;

    return rows.map((row) => ({
      date: row.date.toISOString().slice(0, 10),
      orders: Number(row.orders),
      revenue: Number(row.revenue ?? 0),
    }));
  }

  async topRestaurants(from: Date, to: Date, limit: number): Promise<LeaderboardRow[]> {
    const rows = await this.prisma.$queryRaw<
      Array<{
        id: string;
        name: string;
        orders: bigint;
        revenue: string | null;
        rating: string | null;
      }>
    >`
      SELECT r."id", r."name", COUNT(o."id") AS orders, SUM(o."total_amount") AS revenue, r."rating"
      FROM "orders" o
      JOIN "restaurants" r ON r."id" = o."restaurant_id"
      WHERE o."created_at" >= ${from} AND o."created_at" <= ${to}
        AND o."status" = ANY(${REVENUE_STATUSES}::"order_status"[])
      GROUP BY r."id", r."name", r."rating"
      ORDER BY revenue DESC NULLS LAST
      LIMIT ${limit}
    `;

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      orders: Number(row.orders),
      revenue: Number(row.revenue ?? 0),
      rating: row.rating === null ? null : Number(row.rating),
    }));
  }

  async topRiders(from: Date, to: Date, limit: number): Promise<LeaderboardRow[]> {
    const rows = await this.prisma.$queryRaw<
      Array<{
        id: string;
        name: string;
        orders: bigint;
        revenue: string | null;
        rating: string | null;
      }>
    >`
      SELECT d."id", u."full_name" AS name, COUNT(o."id") AS orders,
             COALESCE(SUM(e."amount"), 0) AS revenue, d."rating"
      FROM "orders" o
      JOIN "drivers" d ON d."id" = o."driver_id"
      JOIN "users" u ON u."id" = d."user_id"
      LEFT JOIN "driver_earnings" e ON e."order_id" = o."id"
      WHERE o."created_at" >= ${from} AND o."created_at" <= ${to}
        AND o."status" = ${OrderStatus.DELIVERED}::"order_status"
      GROUP BY d."id", u."full_name", d."rating"
      ORDER BY orders DESC
      LIMIT ${limit}
    `;

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      // For a rider, "revenue" is what they earned rather than what they carried.
      orders: Number(row.orders),
      revenue: Number(row.revenue ?? 0),
      rating: row.rating === null ? null : Number(row.rating),
    }));
  }

  async topCustomers(from: Date, to: Date, limit: number): Promise<LeaderboardRow[]> {
    const rows = await this.prisma.$queryRaw<
      Array<{ id: string; name: string; orders: bigint; revenue: string | null }>
    >`
      SELECT u."id", u."full_name" AS name, COUNT(o."id") AS orders, SUM(o."total_amount") AS revenue
      FROM "orders" o
      JOIN "users" u ON u."id" = o."customer_id"
      WHERE o."created_at" >= ${from} AND o."created_at" <= ${to}
        AND o."status" = ANY(${REVENUE_STATUSES}::"order_status"[])
      GROUP BY u."id", u."full_name"
      ORDER BY revenue DESC NULLS LAST
      LIMIT ${limit}
    `;

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      orders: Number(row.orders),
      revenue: Number(row.revenue ?? 0),
      rating: null,
    }));
  }

  async ordersByStatus(from: Date, to: Date): Promise<Array<{ status: string; count: number }>> {
    const grouped = await this.prisma.order.groupBy({
      by: ['status'],
      where: { createdAt: { gte: from, lte: to } },
      _count: { _all: true },
    });

    return grouped.map((row) => ({ status: row.status, count: row._count._all }));
  }

  async revenueByPaymentMethod(
    from: Date,
    to: Date,
  ): Promise<Array<{ method: string; count: number; amount: number }>> {
    const grouped = await this.prisma.order.groupBy({
      by: ['paymentMethod'],
      where: {
        createdAt: { gte: from, lte: to },
        status: { in: REVENUE_STATUSES },
        paymentStatus: { in: [PaymentStatus.PAID, PaymentStatus.PARTIALLY_REFUNDED] },
      },
      _count: { _all: true },
      _sum: { totalAmount: true },
    });

    return grouped.map((row) => ({
      method: row.paymentMethod,
      count: row._count._all,
      amount: Number(row._sum.totalAmount ?? 0),
    }));
  }

  async ordersByZone(
    from: Date,
    to: Date,
  ): Promise<Array<{ zoneId: string; zoneName: string; orders: number; revenue: number }>> {
    const rows = await this.prisma.$queryRaw<
      Array<{ zone_id: string; zone_name: string; orders: bigint; revenue: string | null }>
    >`
      SELECT z."id" AS zone_id, z."name" AS zone_name, COUNT(o."id") AS orders,
             SUM(o."total_amount") AS revenue
      FROM "orders" o
      JOIN "zones" z ON z."id" = o."zone_id"
      WHERE o."created_at" >= ${from} AND o."created_at" <= ${to}
        AND o."status" = ANY(${REVENUE_STATUSES}::"order_status"[])
      GROUP BY z."id", z."name"
      ORDER BY orders DESC
    `;

    return rows.map((row) => ({
      zoneId: row.zone_id,
      zoneName: row.zone_name,
      orders: Number(row.orders),
      revenue: Number(row.revenue ?? 0),
    }));
  }

  async couponUsage(
    from: Date,
    to: Date,
  ): Promise<Array<{ couponId: string; code: string; redemptions: number; discount: number }>> {
    const rows = await this.prisma.$queryRaw<
      Array<{ coupon_id: string; code: string; redemptions: bigint; discount: string | null }>
    >`
      SELECT c."id" AS coupon_id, c."code", COUNT(r."id") AS redemptions,
             SUM(r."discount_amount") AS discount
      FROM "coupon_redemptions" r
      JOIN "coupons" c ON c."id" = r."coupon_id"
      WHERE r."created_at" >= ${from} AND r."created_at" <= ${to}
      GROUP BY c."id", c."code"
      ORDER BY discount DESC NULLS LAST
    `;

    return rows.map((row) => ({
      couponId: row.coupon_id,
      code: row.code,
      redemptions: Number(row.redemptions),
      discount: Number(row.discount ?? 0),
    }));
  }

  async cancellations(
    from: Date,
    to: Date,
  ): Promise<Array<{ status: string; cancelledBy: string | null; count: number }>> {
    const grouped = await this.prisma.order.groupBy({
      by: ['status', 'cancelledBy'],
      where: {
        createdAt: { gte: from, lte: to },
        status: { in: [OrderStatus.CANCELLED, OrderStatus.REJECTED, OrderStatus.FAILED] },
      },
      _count: { _all: true },
    });

    return grouped.map((row) => ({
      status: row.status,
      cancelledBy: row.cancelledBy,
      count: row._count._all,
    }));
  }
}
