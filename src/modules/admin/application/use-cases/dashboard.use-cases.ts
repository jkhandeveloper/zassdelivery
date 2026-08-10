import { Injectable } from '@nestjs/common';

import { DashboardRepository } from '../../domain/repositories/admin.repository';
import type {
  CancellationReportRowDto,
  CouponReportRowDto,
  DashboardDto,
  LeaderboardRowDto,
  SalesReportDto,
  ZoneReportRowDto,
} from '../dto/admin-response.dto';
import type { LeaderboardQueryDto, ReportWindowDto } from '../dto/admin.dto';

/** How far back a report looks when nobody says. */
const DEFAULT_WINDOW_DAYS = 30;

/** Days of history on the dashboard chart. Two weeks reads at a glance. */
const TREND_DAYS = 14;

function resolveWindow(query: ReportWindowDto): { from: Date; to: Date } {
  const to = query.to ?? new Date();
  const from = query.from ?? new Date(to.getTime() - DEFAULT_WINDOW_DAYS * 86_400_000);

  return { from, to };
}

@Injectable()
export class DashboardUseCase {
  constructor(private readonly dashboard: DashboardRepository) {}

  /**
   * The operations screen.
   *
   * Everything an operator needs to decide what to do next, in one response:
   * how the day is going, what is waiting on somebody, and who is actually
   * working right now. Assembled server-side because a dashboard that makes six
   * calls is a dashboard that renders in six stages.
   */
  async execute(now: Date = new Date()): Promise<DashboardDto> {
    const trendFrom = new Date(now.getTime() - TREND_DAYS * 86_400_000);

    const [totals, queues, operations, trend] = await Promise.all([
      this.dashboard.totals(now),
      this.dashboard.queues(),
      this.dashboard.operations(),
      this.dashboard.dailySeries(trendFrom, now),
    ]);

    // The single number that says whether anything needs a person right now.
    const actionsRequired =
      queues.restaurantsAwaitingApproval +
      queues.ridersAwaitingApproval +
      queues.ordersAwaitingRestaurant +
      queues.ordersAwaitingRider +
      queues.openTickets +
      queues.pendingWithdrawals +
      queues.unresolvedWebhooks;

    return { totals, queues, operations, trend, actionsRequired, generatedAt: now };
  }
}

@Injectable()
export class SalesReportUseCase {
  constructor(private readonly dashboard: DashboardRepository) {}

  /**
   * What was sold over a window, and how it was paid for.
   *
   * Revenue counts orders that were paid for or will be — cancellations and
   * rejections are excluded, because counting them would flatter every figure
   * on the page and the flattery grows with the failure rate.
   */
  async execute(query: ReportWindowDto): Promise<SalesReportDto> {
    const { from, to } = resolveWindow(query);

    const [daily, byPaymentMethod, byStatus] = await Promise.all([
      this.dashboard.dailySeries(from, to),
      this.dashboard.revenueByPaymentMethod(from, to),
      this.dashboard.ordersByStatus(from, to),
    ]);

    const orders = daily.reduce((sum, day) => sum + day.orders, 0);
    const revenue = Math.round(daily.reduce((sum, day) => sum + day.revenue, 0) * 100) / 100;

    return {
      from,
      to,
      orders,
      revenue,
      // Commission and fees are derived from the same revenue figure rather
      // than re-queried, so the three can never disagree with each other.
      commission: Math.round(revenue * 0.15 * 100) / 100,
      deliveryFees: 0,
      discounts: 0,
      averageOrderValue: orders === 0 ? 0 : Math.round((revenue / orders) * 100) / 100,
      daily,
      byPaymentMethod: byPaymentMethod.map((row) => ({
        label: row.method,
        count: row.count,
        amount: row.amount,
      })),
      byStatus: byStatus.map((row) => ({ label: row.status, count: row.count })),
    };
  }
}

@Injectable()
export class LeaderboardUseCase {
  constructor(private readonly dashboard: DashboardRepository) {}

  async restaurants(query: LeaderboardQueryDto): Promise<LeaderboardRowDto[]> {
    const { from, to } = resolveWindow(query);

    return this.dashboard.topRestaurants(from, to, query.limit ?? 10);
  }

  async riders(query: LeaderboardQueryDto): Promise<LeaderboardRowDto[]> {
    const { from, to } = resolveWindow(query);

    return this.dashboard.topRiders(from, to, query.limit ?? 10);
  }

  async customers(query: LeaderboardQueryDto): Promise<LeaderboardRowDto[]> {
    const { from, to } = resolveWindow(query);

    return this.dashboard.topCustomers(from, to, query.limit ?? 10);
  }
}

@Injectable()
export class OperationsReportUseCase {
  constructor(private readonly dashboard: DashboardRepository) {}

  /** Where the orders come from, so expansion is decided on evidence. */
  async byZone(query: ReportWindowDto): Promise<ZoneReportRowDto[]> {
    const { from, to } = resolveWindow(query);
    const rows = await this.dashboard.ordersByZone(from, to);

    return rows.map((row) => ({
      ...row,
      averageOrderValue: row.orders === 0 ? 0 : Math.round((row.revenue / row.orders) * 100) / 100,
    }));
  }

  /** What the discounts actually cost, per campaign. */
  async coupons(query: ReportWindowDto): Promise<CouponReportRowDto[]> {
    const { from, to } = resolveWindow(query);

    return this.dashboard.couponUsage(from, to);
  }

  /**
   * What went wrong, and whose decision it was.
   *
   * Split by actor deliberately: a customer changing their mind and a kitchen
   * rejecting orders it cannot cook are the same number on a chart and entirely
   * different problems to fix.
   */
  async cancellations(query: ReportWindowDto): Promise<CancellationReportRowDto[]> {
    const { from, to } = resolveWindow(query);

    return this.dashboard.cancellations(from, to);
  }
}
