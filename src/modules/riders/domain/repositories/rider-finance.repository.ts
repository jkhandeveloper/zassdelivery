import type {
  DriverEarning,
  DriverEarningType,
  PaymentMethod,
  Prisma,
  RiderLedgerEntry,
  RiderSettlement,
  RiderSettlementDirection,
} from '@prisma/client';

import type { PaginatedResult } from '@/common/interfaces/paginated-result.interface';

export interface ListEarningsFilter {
  page: number;
  limit: number;
  orderBy: Prisma.DriverEarningOrderByWithRelationInput;
  driverId: string;
  type?: DriverEarningType;
  from?: Date;
  to?: Date;
}

export type EarningWithOrder = DriverEarning & {
  order: { id: string; orderNumber: string } | null;
};

/** Totals over a window, for the rider's earnings header. */
export interface EarningsSummary {
  today: number;
  thisWeek: number;
  thisMonth: number;
  lifetime: number;
  deliveriesToday: number;
  deliveriesThisWeek: number;
  deliveriesLifetime: number;
}

export interface RecordDeliveryInput {
  driverId: string;
  restaurantId: string;
  orderId: string;
  assignmentId: string;
  /** What the customer paid for the order, taken from the order itself. */
  totalAmount: number;
  components: Array<{ type: DriverEarningType; amount: number; description: string }>;
  total: number;
}

/** What a delivered order left the rider and the restaurant owing each other. */
export interface RecordedDelivery {
  /** Delivery fee plus tip, kept by the rider. */
  earned: number;
  /** Money the rider took from the customer. Zero when the restaurant was paid. */
  collected: number;
  /** collected - earned. Positive: rider owes the restaurant. Negative: the reverse. */
  net: number;
}

// ── Rider ↔ restaurant settlement ─────────────────────────────

/**
 * Running totals between one rider and one restaurant.
 *
 * `balance` is what the rider owes the restaurant: order money collected, less
 * the rider's fees, less cash already handed over, plus fees already paid.
 * Negative means the restaurant owes the rider.
 */
export interface SettlementTotals {
  driverId: string;
  restaurantId: string;
  deliveries: number;
  cashCollected: number;
  riderFees: number;
  cashHandedOver: number;
  feesPaid: number;
  balance: number;
  lastActivityAt: Date | null;
}

export type RestaurantBalance = SettlementTotals & {
  restaurant: { name: string; phone: string | null; addressLine: string };
};

export type RiderBalance = SettlementTotals & {
  driver: { fullName: string; phone: string; paymentQrCodes: Prisma.JsonValue };
};

export interface SettlementScope {
  driverId?: string;
  restaurantId?: string;
  page: number;
  limit: number;
}

export type LedgerEntryWithContext = RiderLedgerEntry & {
  order: { orderNumber: string; paymentMethod: PaymentMethod };
  restaurant: { name: string };
  driver: { user: { fullName: string } };
};

export type SettlementWithContext = RiderSettlement & {
  restaurant: { name: string };
  driver: { user: { fullName: string } };
  recordedBy: { fullName: string } | null;
};

export interface RecordSettlementInput {
  driverId: string;
  restaurantId: string;
  direction: RiderSettlementDirection;
  amount: number;
  note: string | null;
  recordedById: string;
}

export abstract class RiderFinanceRepository {
  // ── Earnings ─────────────────────────────────────────────────

  abstract listEarnings(filter: ListEarningsFilter): Promise<PaginatedResult<EarningWithOrder>>;
  abstract summarise(driverId: string, now: Date): Promise<EarningsSummary>;

  /**
   * Records a completed delivery: the rider's earning rows and the entry that
   * says who owes whom for it, in one transaction.
   *
   * Nothing is credited anywhere. The platform never holds order money, so the
   * rider's fee comes out of the cash they collected, or from the restaurant.
   *
   * Idempotent on the order: a retried delivery confirmation must not count the
   * same run twice.
   */
  abstract recordDelivery(input: RecordDeliveryInput): Promise<RecordedDelivery>;

  // ── Settlement ───────────────────────────────────────────────

  abstract balancesForRider(driverId: string): Promise<RestaurantBalance[]>;
  abstract balancesForRestaurant(restaurantId: string): Promise<RiderBalance[]>;

  abstract listLedgerEntries(
    scope: SettlementScope,
  ): Promise<PaginatedResult<LedgerEntryWithContext>>;
  abstract listSettlements(scope: SettlementScope): Promise<PaginatedResult<SettlementWithContext>>;

  /**
   * Records money that changed hands between a rider and a restaurant.
   *
   * The balance is re-read inside the transaction, under a lock on the pair,
   * and the amount may not exceed what is owed in that direction: two people
   * recording the same handover at once must not push the balance past zero.
   */
  abstract recordSettlement(input: RecordSettlementInput): Promise<SettlementWithContext>;
}
