import type {
  Restaurant,
  SubscriptionInvoice,
  SubscriptionInvoiceStatus,
  SubscriptionStatus,
  User,
  VendorSubscription,
} from '@prisma/client';

import type { PaymentQrProvider } from '@/common/dto/payment-qr-code.dto';
import type { PaginatedResult } from '@/common/interfaces/paginated-result.interface';

/** A subscription with the listing and the person who pays for it. */
export type SubscriptionWithContext = VendorSubscription & {
  restaurant: Pick<Restaurant, 'id' | 'name' | 'slug' | 'status' | 'logoUrl'>;
  owner: Pick<User, 'id' | 'fullName' | 'phone' | 'email'>;
};

/** An invoice with enough context to render a queue row without a second query. */
export type InvoiceWithContext = SubscriptionInvoice & {
  restaurant: Pick<Restaurant, 'id' | 'name' | 'slug' | 'status'>;
  subscription: Pick<VendorSubscription, 'id' | 'ownerId' | 'status' | 'currency'> & {
    owner: Pick<User, 'id' | 'fullName' | 'phone'>;
  };
};

export interface ListSubscriptionsFilter {
  page: number;
  limit: number;
  status?: SubscriptionStatus;
  /** Matches the restaurant name or the owner's name or phone. */
  search?: string;
}

export interface ListInvoicesFilter {
  page: number;
  limit: number;
  status?: SubscriptionInvoiceStatus;
  restaurantId?: string;
  subscriptionId?: string;
  /** Matches the invoice number or the quoted transfer reference. */
  search?: string;
  from?: Date;
  to?: Date;
}

export interface CreateSubscriptionInput {
  restaurantId: string;
  ownerId: string;
  /** The free first month, which begins the day the listing is approved. */
  trialStart: Date;
  trialEnd: Date;
}

export interface CreateInvoiceInput {
  subscriptionId: string;
  restaurantId: string;
  amount: number;
  currency: string;
  periodStart: Date;
  periodEnd: Date;
  dueAt: Date;
  blockAt: Date;
  isTrial: boolean;
}

export interface SubmitTransferInput {
  invoiceId: string;
  channel: PaymentQrProvider;
  reference: string | null;
  proofImageUrl: string | null;
  submittedById: string;
}

export interface ConfirmInvoiceInput {
  invoiceId: string;
  confirmedById: string;
  /** The period the payment buys, computed by the caller from the schedule. */
  nextPeriodStart: Date;
  nextPeriodEnd: Date;

  /**
   * What an administrator entering the payment themselves knows about it.
   *
   * Omitted when confirming a transfer the vendor already reported, in which
   * case their own details stand — the settlement is the same event either way,
   * and giving it two code paths is how the ledger ends up written twice.
   */
  channel?: PaymentQrProvider;
  reference?: string | null;
  paidAt?: Date;
}

/**
 * Everything billing reads and writes.
 *
 * Split from the payments repository deliberately: a subscription charge
 * belongs to no order, and every method on `PaymentRepository` is reached
 * through one.
 */
export abstract class BillingRepository {
  // ── Subscriptions ──

  abstract findSubscriptionById(id: string): Promise<SubscriptionWithContext | null>;
  abstract findSubscriptionForRestaurant(
    restaurantId: string,
  ): Promise<SubscriptionWithContext | null>;
  abstract findSubscriptions(
    filter: ListSubscriptionsFilter,
  ): Promise<PaginatedResult<SubscriptionWithContext>>;

  /** Opens a subscription on its free first month. */
  abstract createSubscription(input: CreateSubscriptionInput): Promise<SubscriptionWithContext>;

  /** Null restores this vendor to the platform's standard rate. */
  abstract setMonthlyFee(
    subscriptionId: string,
    monthlyFee: number | null,
  ): Promise<SubscriptionWithContext>;

  // ── Invoices ──

  abstract findInvoiceById(id: string): Promise<InvoiceWithContext | null>;
  abstract findInvoices(filter: ListInvoicesFilter): Promise<PaginatedResult<InvoiceWithContext>>;

  /**
   * Opens an invoice and stamps it with the next number from the sequence.
   *
   * A sequence rather than a count, for the same reason payment references use
   * one: the nightly sweep issues every invoice on the platform at once, and
   * two computed in the same millisecond would collide on the unique index.
   */
  abstract createInvoice(input: CreateInvoiceInput): Promise<InvoiceWithContext>;

  /**
   * Records what the vendor says they transferred. Moves the invoice to
   * PENDING_REVIEW; it is not paid until a human agrees it arrived.
   */
  abstract submitTransfer(input: SubmitTransferInput): Promise<InvoiceWithContext>;

  /**
   * Settles an invoice and everything that follows from it, as one unit.
   *
   * The invoice is marked paid, the subscription rolls onto the period the
   * money buys, a FEE row lands in the shared ledger, and a listing that
   * *billing* took down comes back up. Half of that applied would leave a vendor
   * who has paid still suspended, which is the one outcome worth a transaction.
   */
  abstract confirmInvoice(input: ConfirmInvoiceInput): Promise<InvoiceWithContext>;

  /** The transfer could not be found. The invoice goes back to OPEN. */
  abstract rejectTransfer(
    invoiceId: string,
    reason: string,
    reviewedById: string,
  ): Promise<InvoiceWithContext>;

  /** Waived. Closes the period without money changing hands. */
  abstract voidInvoice(
    invoiceId: string,
    reason: string,
    reviewedById: string,
    nextPeriod: { start: Date; end: Date },
  ): Promise<InvoiceWithContext>;

  /**
   * Corrects how a settled invoice was paid, without re-settling it.
   *
   * A mistyped transaction ID is a clerical error, not a second payment: the
   * money moved once, so the ledger row it already wrote stands untouched.
   */
  abstract updatePaymentRecord(
    invoiceId: string,
    input: { channel?: PaymentQrProvider; reference?: string | null; paidAt?: Date },
  ): Promise<InvoiceWithContext>;

  // ── Re-pricing after a rate change ──

  /**
   * Re-prices this vendor's unpaid invoice.
   *
   * Only an OPEN one. A vendor who has already reported a transfer is owed the
   * amount they were quoted when they sent it, and moving the figure under them
   * is how a correct payment starts looking short.
   */
  abstract repriceOpenInvoice(
    subscriptionId: string,
    amount: number,
  ): Promise<InvoiceWithContext | null>;

  /**
   * The same, for every vendor on the platform's standard rate.
   *
   * Returns the owner ids whose bill actually moved, so each of them can be
   * told what they now owe. Without this a price change would reach nobody
   * until their next invoice a month later.
   */
  abstract repriceStandardRateInvoices(amount: number): Promise<string[]>;

  // ── The nightly sweep ──

  /**
   * Live listings with no subscription yet.
   *
   * The backfill for restaurants that were already trading when billing
   * arrived, and the safety net for an approval whose event was missed.
   */
  abstract findActiveRestaurantsWithoutSubscription(
    limit: number,
  ): Promise<Array<Pick<Restaurant, 'id' | 'ownerId' | 'approvedAt'>>>;

  /**
   * Subscriptions whose next period has no invoice raised for it yet.
   *
   * One open invoice exists at all times, so a vendor can pay early rather than
   * being made to wait for a bill they already know is coming.
   */
  abstract findSubscriptionsNeedingInvoice(limit: number): Promise<SubscriptionWithContext[]>;

  /** Unpaid invoices inside the reminder window. */
  abstract findInvoicesToRemind(
    now: Date,
    leadDays: number,
    limit: number,
  ): Promise<InvoiceWithContext[]>;

  /** Unpaid invoices whose due date has passed but whose grace has not. */
  abstract findInvoicesPastDue(now: Date, limit: number): Promise<InvoiceWithContext[]>;

  /** Unpaid invoices whose grace has run out. */
  abstract findInvoicesToBlock(now: Date, limit: number): Promise<InvoiceWithContext[]>;

  abstract markReminderSent(invoiceId: string, bucket: number): Promise<void>;

  /** Past the due date, still trading, inside grace. */
  abstract markPastDue(subscriptionId: string): Promise<void>;

  /**
   * Takes the listing down, recording that billing was the one that did it and
   * what the status was before — so a later payment reinstates the vendor
   * without overturning a suspension an administrator made for other reasons.
   */
  abstract suspendForNonPayment(subscriptionId: string): Promise<SubscriptionWithContext>;

  // ── An administrator acting by hand ──

  /**
   * Closes an account on the platform's say-so, for any reason of its own.
   *
   * Recorded as an administrative suspension — `suspendedByBilling` stays false
   * — so settling an invoice later does not quietly undo it. What an
   * administrator closed, only an administrator reopens.
   */
  abstract suspendByAdmin(
    subscriptionId: string,
    reason: string | null,
  ): Promise<SubscriptionWithContext>;

  /**
   * Reopens an account, whatever took it down.
   *
   * Any invoice still outstanding gets a fresh grace window of `graceDays`,
   * because reopening a vendor that tonight's sweep would close again within
   * hours is not reopening them at all. The window is only ever lengthened,
   * never cut short.
   */
  abstract reinstateByAdmin(
    subscriptionId: string,
    graceDays: number,
  ): Promise<SubscriptionWithContext>;
}
