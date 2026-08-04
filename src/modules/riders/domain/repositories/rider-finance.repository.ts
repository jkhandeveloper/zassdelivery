import type {
  DriverEarning,
  DriverEarningType,
  PayoutMethod,
  PayoutRequest,
  PayoutStatus,
  Prisma,
  WalletTransaction,
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

export interface CreditEarningsInput {
  driverId: string;
  /** The user whose wallet receives the money — the rider behind the profile. */
  userId: string;
  orderId: string;
  orderNumber: string;
  assignmentId: string;
  components: Array<{ type: DriverEarningType; amount: number; description: string }>;
  total: number;
}

export interface ListPayoutsFilter {
  page: number;
  limit: number;
  orderBy: Prisma.PayoutRequestOrderByWithRelationInput;
  driverId?: string;
  status?: PayoutStatus;
  from?: Date;
  to?: Date;
}

export interface RequestPayoutInput {
  driverId: string;
  userId: string;
  amount: number;
  method: PayoutMethod;
  bankName: string | null;
  accountTitle: string;
  accountNumber: string;
}

export interface WalletSnapshot {
  balance: number;
  currency: string;
  isLocked: boolean;
  /** Money already committed to withdrawal requests still being processed. */
  pendingWithdrawals: number;
}

export abstract class RiderFinanceRepository {
  // ── Earnings ─────────────────────────────────────────────────

  abstract listEarnings(filter: ListEarningsFilter): Promise<PaginatedResult<EarningWithOrder>>;
  abstract summarise(driverId: string, now: Date): Promise<EarningsSummary>;

  /**
   * Posts a completed delivery's earnings and credits the rider's wallet in one
   * transaction: earning rows, wallet balance, wallet ledger entry and the
   * platform payout transaction all land together, or none of them do.
   *
   * Idempotent on the order — a retried delivery confirmation must not pay the
   * rider twice.
   */
  abstract creditDeliveryEarnings(input: CreditEarningsInput): Promise<number>;

  // ── Wallet ───────────────────────────────────────────────────

  abstract walletFor(userId: string): Promise<WalletSnapshot>;
  abstract listWalletTransactions(
    userId: string,
    page: number,
    limit: number,
  ): Promise<PaginatedResult<WalletTransaction>>;

  // ── Withdrawals ──────────────────────────────────────────────

  abstract listPayouts(filter: ListPayoutsFilter): Promise<PaginatedResult<PayoutRequest>>;
  abstract findPayout(id: string): Promise<PayoutRequest | null>;
  abstract hasOpenPayout(driverId: string): Promise<boolean>;

  /**
   * Creates the request and debits the wallet in the same transaction, so the
   * money cannot be spent while an operator is still deciding. The balance is
   * re-read inside that transaction: a check made beforehand would be stale by
   * the time it mattered.
   */
  abstract requestPayout(input: RequestPayoutInput): Promise<PayoutRequest>;

  abstract approvePayout(id: string, reviewerId: string): Promise<PayoutRequest>;

  /** Marks the transfer done and records the bank or gateway reference. */
  abstract markPayoutPaid(
    id: string,
    reviewerId: string,
    paymentReference: string | null,
  ): Promise<PayoutRequest>;

  /** Returns the held amount to the wallet and closes the request. */
  abstract refundPayout(
    id: string,
    status: PayoutStatus,
    context: { reviewerId: string | null; reason: string },
  ): Promise<PayoutRequest>;
}
