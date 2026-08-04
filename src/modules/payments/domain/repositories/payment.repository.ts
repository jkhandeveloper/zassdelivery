import { type PaymentStatus } from '@prisma/client';
import type {
  Order,
  Payment,
  PaymentMethod,
  Prisma,
  Transaction,
  TransactionStatus,
  TransactionType,
  User,
  WebhookEvent,
  WebhookStatus,
} from '@prisma/client';

import type { PaginatedResult } from '@/common/interfaces/paginated-result.interface';

/** A payment with the order and payer context every screen needs. */
export type PaymentWithContext = Payment & {
  order: Pick<
    Order,
    | 'id'
    | 'orderNumber'
    | 'status'
    | 'customerId'
    | 'restaurantId'
    | 'totalAmount'
    | 'paymentStatus'
  >;
  user: Pick<User, 'id' | 'fullName' | 'phone' | 'email'>;
};

export interface ListPaymentsFilter {
  page: number;
  limit: number;
  orderBy: Prisma.PaymentOrderByWithRelationInput;
  userId?: string;
  orderId?: string;
  status?: PaymentStatus;
  method?: PaymentMethod;
  gatewayName?: string;
  /** Matches our reference, the gateway's id, or the order number. */
  search?: string;
  from?: Date;
  to?: Date;
}

export interface CreateAttemptInput {
  orderId: string;
  userId: string;
  method: PaymentMethod;
  amount: number;
  gatewayName: string | null;
  expiresAt: Date | null;
}

/** Everything a settlement changes, applied as one unit. */
export interface SettleInput {
  paymentId: string;
  gatewayTransactionId: string | null;
  gatewayResponse: Prisma.InputJsonValue | null;
  /** AUTHORIZED holds the money; PAID has moved it. */
  status: typeof PaymentStatus.PAID | typeof PaymentStatus.AUTHORIZED;
}

export interface FailInput {
  paymentId: string;
  reason: string;
  gatewayResponse: Prisma.InputJsonValue | null;
  status: typeof PaymentStatus.FAILED | typeof PaymentStatus.CANCELLED;
  /**
   * Whether the order this attempt belongs to should fail with it. False when
   * the customer is expected to try again — a declined card is not a dead order.
   */
  failOrder: boolean;
}

export interface RecordRefundInput {
  paymentId: string;
  orderId: string;
  userId: string;
  amount: number;
  reason: string;
  /** Where the money went: back to the card/wallet provider, or to our wallet. */
  destination: 'GATEWAY' | 'WALLET';
  gatewayRefundId: string | null;
  /** PENDING while a gateway is still processing it. */
  status: TransactionStatus;
  actorId: string;
}

export interface ListTransactionsFilter {
  page: number;
  limit: number;
  orderBy: Prisma.TransactionOrderByWithRelationInput;
  userId?: string;
  orderId?: string;
  paymentId?: string;
  type?: TransactionType;
  status?: TransactionStatus;
  search?: string;
  from?: Date;
  to?: Date;
}

/** One row of the money-movement summary. */
export interface LedgerTotal {
  type: TransactionType;
  status: TransactionStatus;
  count: number;
  amount: number;
}

export abstract class PaymentRepository {
  abstract findMany(filter: ListPaymentsFilter): Promise<PaginatedResult<PaymentWithContext>>;
  abstract findById(id: string): Promise<PaymentWithContext | null>;
  abstract findByReference(reference: string): Promise<PaymentWithContext | null>;

  /** The open attempt for an order, if the customer already started one. */
  abstract findOpenForOrder(orderId: string): Promise<PaymentWithContext | null>;

  /**
   * Opens an attempt and stamps it with the next merchant reference.
   *
   * The reference comes from a Postgres sequence: two checkouts in the same
   * millisecond would otherwise send the gateway the same merchant id for two
   * different payments, and the gateway would be right to reject one of them.
   */
  abstract createAttempt(input: CreateAttemptInput): Promise<PaymentWithContext>;

  /**
   * Settles an attempt: the payment, its order, the ledger entry and the
   * commission all move together.
   *
   * Idempotent on the payment — a webhook and a browser return describing the
   * same success must produce one settlement, not two.
   */
  abstract settle(input: SettleInput): Promise<PaymentWithContext>;

  /**
   * Fails an attempt, and — when the order dies with it — returns the stock
   * that checkout claimed. Held stock nobody paid for is stock the next
   * customer could not buy.
   */
  abstract fail(input: FailInput): Promise<PaymentWithContext>;

  /** Marks the money collected on the doorstep for a cash order. */
  abstract settleCash(paymentId: string, actorId: string): Promise<PaymentWithContext>;

  abstract totalRefunded(paymentId: string): Promise<number>;

  /** Records a refund: ledger entry, payment totals and — for wallet refunds — the credit. */
  abstract recordRefund(input: RecordRefundInput): Promise<Transaction>;

  /** Online attempts whose checkout window has closed. */
  abstract findExpired(now: Date, limit: number): Promise<PaymentWithContext[]>;

  // ── Ledger ───────────────────────────────────────────────────

  abstract listTransactions(filter: ListTransactionsFilter): Promise<PaginatedResult<Transaction>>;
  abstract summariseTransactions(from: Date, to: Date): Promise<LedgerTotal[]>;
}

export interface RecordWebhookInput {
  gateway: string;
  eventId: string;
  payload: Prisma.InputJsonValue;
  signature: string | null;
}

export abstract class WebhookEventRepository {
  /**
   * Stores a callback before anything is done with it.
   *
   * Returns `duplicate: true` when this gateway has already sent this event —
   * that is the replay guard, and it is a unique index rather than a lookup so
   * two simultaneous redeliveries cannot both get through.
   */
  abstract record(input: RecordWebhookInput): Promise<{ event: WebhookEvent; duplicate: boolean }>;

  abstract resolve(
    id: string,
    input: {
      status: WebhookStatus;
      paymentId?: string | null;
      error?: string | null;
    },
  ): Promise<WebhookEvent>;

  abstract findById(id: string): Promise<WebhookEvent | null>;

  abstract findMany(filter: {
    page: number;
    limit: number;
    gateway?: string;
    status?: WebhookStatus;
    paymentId?: string;
    from?: Date;
    to?: Date;
  }): Promise<PaginatedResult<WebhookEvent>>;
}
