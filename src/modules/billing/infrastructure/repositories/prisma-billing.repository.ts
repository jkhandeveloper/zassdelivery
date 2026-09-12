import { Injectable } from '@nestjs/common';
import {
  Prisma,
  RestaurantStatus,
  SubscriptionInvoiceStatus,
  SubscriptionStatus,
  TransactionStatus,
  TransactionType,
} from '@prisma/client';
import type { Restaurant } from '@prisma/client';

import type { PaymentQrProvider } from '@/common/dto/payment-qr-code.dto';
import { ResourceConflictException } from '@/common/exceptions/domain.exception';
import type { PaginatedResult } from '@/common/interfaces/paginated-result.interface';
import { paginate } from '@/common/utils/pagination.util';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';

import {
  BillingRepository,
  type ConfirmInvoiceInput,
  type CreateInvoiceInput,
  type CreateSubscriptionInput,
  type InvoiceWithContext,
  type ListInvoicesFilter,
  type ListSubscriptionsFilter,
  type SubmitTransferInput,
  type SubscriptionWithContext,
} from '../../domain/repositories/billing.repository';

const SUBSCRIPTION_CONTEXT = {
  restaurant: { select: { id: true, name: true, slug: true, status: true, logoUrl: true } },
  owner: { select: { id: true, fullName: true, phone: true, email: true } },
} satisfies Prisma.VendorSubscriptionInclude;

const INVOICE_CONTEXT = {
  restaurant: { select: { id: true, name: true, slug: true, status: true } },
  subscription: {
    select: {
      id: true,
      ownerId: true,
      status: true,
      currency: true,
      owner: { select: { id: true, fullName: true, phone: true } },
    },
  },
} satisfies Prisma.SubscriptionInvoiceInclude;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Invoices still awaiting money. PENDING_REVIEW is not among them on purpose. */
const UNPAID: SubscriptionInvoiceStatus[] = [SubscriptionInvoiceStatus.OPEN];

/** Subscriptions that still accrue invoices. */
const BILLABLE: SubscriptionStatus[] = [
  SubscriptionStatus.TRIALING,
  SubscriptionStatus.ACTIVE,
  SubscriptionStatus.PAST_DUE,
  SubscriptionStatus.SUSPENDED,
];

/** Listing states a suspension may legally be applied to. */
const SUSPENDABLE: RestaurantStatus[] = [
  RestaurantStatus.ACTIVE,
  RestaurantStatus.TEMPORARILY_CLOSED,
];

@Injectable()
export class PrismaBillingRepository extends BillingRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  // ── Subscriptions ──────────────────────────────────────────

  async findSubscriptionById(id: string): Promise<SubscriptionWithContext | null> {
    return this.prisma.vendorSubscription.findUnique({
      where: { id },
      include: SUBSCRIPTION_CONTEXT,
    });
  }

  async findSubscriptionForRestaurant(
    restaurantId: string,
  ): Promise<SubscriptionWithContext | null> {
    return this.prisma.vendorSubscription.findUnique({
      where: { restaurantId },
      include: SUBSCRIPTION_CONTEXT,
    });
  }

  async findSubscriptions(
    filter: ListSubscriptionsFilter,
  ): Promise<PaginatedResult<SubscriptionWithContext>> {
    const where: Prisma.VendorSubscriptionWhereInput = {
      ...(filter.status !== undefined && { status: filter.status }),
      ...(filter.search !== undefined &&
        filter.search.length > 0 && {
          OR: [
            { restaurant: { name: { contains: filter.search, mode: 'insensitive' } } },
            { owner: { fullName: { contains: filter.search, mode: 'insensitive' } } },
            { owner: { phone: { contains: filter.search } } },
          ],
        }),
    };

    const [items, total] = await Promise.all([
      this.prisma.vendorSubscription.findMany({
        where,
        include: SUBSCRIPTION_CONTEXT,
        // Whoever is closest to being cut off is who an operator needs to see.
        orderBy: { currentPeriodEnd: 'asc' },
        skip: (filter.page - 1) * filter.limit,
        take: filter.limit,
      }),
      this.prisma.vendorSubscription.count({ where }),
    ]);

    return paginate(items, total, filter.page, filter.limit);
  }

  async createSubscription(input: CreateSubscriptionInput): Promise<SubscriptionWithContext> {
    return this.prisma.vendorSubscription.create({
      data: {
        restaurantId: input.restaurantId,
        ownerId: input.ownerId,
        status: SubscriptionStatus.TRIALING,
        currentPeriodStart: input.trialStart,
        currentPeriodEnd: input.trialEnd,
        trialEndsAt: input.trialEnd,
      },
      include: SUBSCRIPTION_CONTEXT,
    });
  }

  async setMonthlyFee(
    subscriptionId: string,
    monthlyFee: number | null,
  ): Promise<SubscriptionWithContext> {
    return this.prisma.vendorSubscription.update({
      where: { id: subscriptionId },
      data: { monthlyFee },
      include: SUBSCRIPTION_CONTEXT,
    });
  }

  // ── Invoices ───────────────────────────────────────────────

  async findInvoiceById(id: string): Promise<InvoiceWithContext | null> {
    return this.prisma.subscriptionInvoice.findUnique({ where: { id }, include: INVOICE_CONTEXT });
  }

  async findInvoices(filter: ListInvoicesFilter): Promise<PaginatedResult<InvoiceWithContext>> {
    const where: Prisma.SubscriptionInvoiceWhereInput = {
      ...(filter.status !== undefined && { status: filter.status }),
      ...(filter.restaurantId !== undefined && { restaurantId: filter.restaurantId }),
      ...(filter.subscriptionId !== undefined && { subscriptionId: filter.subscriptionId }),
      ...((filter.from !== undefined || filter.to !== undefined) && {
        createdAt: {
          ...(filter.from !== undefined && { gte: filter.from }),
          ...(filter.to !== undefined && { lte: filter.to }),
        },
      }),
      ...(filter.search !== undefined &&
        filter.search.length > 0 && {
          OR: [
            { invoiceNumber: { contains: filter.search, mode: 'insensitive' } },
            { reference: { contains: filter.search, mode: 'insensitive' } },
          ],
        }),
    };

    const [items, total] = await Promise.all([
      this.prisma.subscriptionInvoice.findMany({
        where,
        include: INVOICE_CONTEXT,
        orderBy: { createdAt: 'desc' },
        skip: (filter.page - 1) * filter.limit,
        take: filter.limit,
      }),
      this.prisma.subscriptionInvoice.count({ where }),
    ]);

    return paginate(items, total, filter.page, filter.limit);
  }

  async createInvoice(input: CreateInvoiceInput): Promise<InvoiceWithContext> {
    return this.prisma.$transaction(async (tx) => {
      const invoiceNumber = await this.nextInvoiceNumber(tx);

      return tx.subscriptionInvoice.create({
        data: {
          subscriptionId: input.subscriptionId,
          restaurantId: input.restaurantId,
          invoiceNumber,
          amount: input.amount,
          currency: input.currency,
          periodStart: input.periodStart,
          periodEnd: input.periodEnd,
          dueAt: input.dueAt,
          blockAt: input.blockAt,
          isTrial: input.isTrial,
          // The free month is settled the moment it is raised. It exists so a
          // vendor's history reads continuously, not so they can pay it.
          status: input.isTrial ? SubscriptionInvoiceStatus.PAID : SubscriptionInvoiceStatus.OPEN,
          paidAt: input.isTrial ? new Date() : null,
        },
        include: INVOICE_CONTEXT,
      });
    });
  }

  async submitTransfer(input: SubmitTransferInput): Promise<InvoiceWithContext> {
    if (input.reference !== null) {
      const clash = await this.prisma.subscriptionInvoice.findUnique({
        where: { reference: input.reference },
        select: { invoiceNumber: true },
      });

      // A TID is proof of one transfer. Accepting it twice is how one
      // screenshot pays for two months.
      if (clash !== null) {
        throw new ResourceConflictException(
          `Transaction ID ${input.reference} has already been submitted against invoice ${clash.invoiceNumber}.`,
        );
      }
    }

    return this.prisma.subscriptionInvoice.update({
      where: { id: input.invoiceId },
      data: {
        status: SubscriptionInvoiceStatus.PENDING_REVIEW,
        channel: input.channel,
        reference: input.reference,
        proofImageUrl: input.proofImageUrl,
        submittedById: input.submittedById,
        submittedAt: new Date(),
        // A resubmission after a rejection starts clean, or the vendor sees a
        // stale reason next to a payment they have since corrected.
        rejectedAt: null,
        rejectionReason: null,
      },
      include: INVOICE_CONTEXT,
    });
  }

  async confirmInvoice(input: ConfirmInvoiceInput): Promise<InvoiceWithContext> {
    // Everything a confirmed payment implies lands together: the invoice, the
    // period it buys, the ledger entry and the listing coming back up. A vendor
    // marked paid who is still suspended is the one outcome worth a transaction.
    return this.prisma.$transaction(async (tx) => {
      const invoice = await tx.subscriptionInvoice.findUniqueOrThrow({
        where: { id: input.invoiceId },
        include: { subscription: true },
      });

      // Idempotent: two administrators clearing the same queue are one payment.
      if (invoice.status === SubscriptionInvoiceStatus.PAID) {
        return tx.subscriptionInvoice.findUniqueOrThrow({
          where: { id: input.invoiceId },
          include: INVOICE_CONTEXT,
        });
      }

      if (input.reference !== undefined && input.reference !== null) {
        const clash = await tx.subscriptionInvoice.findFirst({
          where: { reference: input.reference, id: { not: invoice.id } },
          select: { invoiceNumber: true },
        });

        // The same guard the vendor's own submission gets. An administrator
        // typing a TID by hand is no less capable of using one twice.
        if (clash !== null) {
          throw new ResourceConflictException(
            `Transaction ID ${input.reference} is already recorded against invoice ${clash.invoiceNumber}.`,
          );
        }
      }

      const now = new Date();
      // An administrator recording a payment that arrived last Tuesday dates it
      // last Tuesday; a confirmation of what the vendor reported is dated now.
      const paidAt = input.paidAt ?? now;

      await tx.subscriptionInvoice.update({
        where: { id: invoice.id },
        data: {
          status: SubscriptionInvoiceStatus.PAID,
          paidAt,
          confirmedById: input.confirmedById,
          ...(input.channel !== undefined && { channel: input.channel }),
          ...(input.reference !== undefined && { reference: input.reference }),
          rejectedAt: null,
          rejectionReason: null,
        },
      });

      await tx.vendorSubscription.update({
        where: { id: invoice.subscriptionId },
        data: {
          status: SubscriptionStatus.ACTIVE,
          lastPaidAt: paidAt,
          currentPeriodStart: input.nextPeriodStart,
          currentPeriodEnd: input.nextPeriodEnd,
          trialEndsAt: null,
          suspendedAt: null,
          suspendedByBilling: false,
          statusBeforeSuspension: null,
        },
      });

      await this.reinstate(tx, invoice.subscription);

      // The shared ledger, not a billing-only one: money the platform took is
      // money the platform took, whoever it came from.
      await tx.transaction.create({
        data: {
          userId: invoice.subscription.ownerId,
          type: TransactionType.FEE,
          status: TransactionStatus.SUCCESS,
          amount: invoice.amount,
          currency: invoice.currency,
          // The invoice number is already unique, and it is what both sides of
          // a dispute will quote.
          reference: invoice.invoiceNumber,
          description: `Vendor subscription ${invoice.invoiceNumber}`,
          processedAt: paidAt,
        },
      });

      return tx.subscriptionInvoice.findUniqueOrThrow({
        where: { id: invoice.id },
        include: INVOICE_CONTEXT,
      });
    });
  }

  async updatePaymentRecord(
    invoiceId: string,
    input: { channel?: PaymentQrProvider; reference?: string | null; paidAt?: Date },
  ): Promise<InvoiceWithContext> {
    if (input.reference !== undefined && input.reference !== null) {
      const clash = await this.prisma.subscriptionInvoice.findFirst({
        where: { reference: input.reference, id: { not: invoiceId } },
        select: { invoiceNumber: true },
      });

      if (clash !== null) {
        throw new ResourceConflictException(
          `Transaction ID ${input.reference} is already recorded against invoice ${clash.invoiceNumber}.`,
        );
      }
    }

    // The ledger row is deliberately left alone. Correcting which wallet the
    // money came through does not change that it moved, or how much.
    return this.prisma.subscriptionInvoice.update({
      where: { id: invoiceId },
      data: {
        ...(input.channel !== undefined && { channel: input.channel }),
        ...(input.reference !== undefined && { reference: input.reference }),
        ...(input.paidAt !== undefined && { paidAt: input.paidAt }),
      },
      include: INVOICE_CONTEXT,
    });
  }

  async repriceOpenInvoice(
    subscriptionId: string,
    amount: number,
  ): Promise<InvoiceWithContext | null> {
    const open = await this.prisma.subscriptionInvoice.findFirst({
      // Never the trial: a free month re-priced to the new rate would bill a
      // vendor for the month they were promised for nothing.
      where: { subscriptionId, status: SubscriptionInvoiceStatus.OPEN, isTrial: false },
      orderBy: { dueAt: 'asc' },
      select: { id: true },
    });

    if (open === null) {
      return null;
    }

    return this.prisma.subscriptionInvoice.update({
      where: { id: open.id },
      data: { amount },
      include: INVOICE_CONTEXT,
    });
  }

  async repriceStandardRateInvoices(amount: number): Promise<string[]> {
    const affected = await this.prisma.subscriptionInvoice.findMany({
      where: {
        status: SubscriptionInvoiceStatus.OPEN,
        isTrial: false,
        // Null means "whatever the platform charges", which is exactly the set
        // a change to the standard rate is supposed to reach.
        subscription: { monthlyFee: null },
      },
      select: { id: true, subscription: { select: { ownerId: true } } },
    });

    if (affected.length === 0) {
      return [];
    }

    await this.prisma.subscriptionInvoice.updateMany({
      where: { id: { in: affected.map((invoice) => invoice.id) } },
      data: { amount },
    });

    // One owner may hold several listings; they should hear this once.
    return [...new Set(affected.map((invoice) => invoice.subscription.ownerId))];
  }

  async rejectTransfer(
    invoiceId: string,
    reason: string,
    reviewedById: string,
  ): Promise<InvoiceWithContext> {
    return this.prisma.subscriptionInvoice.update({
      where: { id: invoiceId },
      data: {
        // Back to unpaid, deliberately. If the grace window has already passed
        // while this sat in review, the next sweep suspends the listing — which
        // is the correct answer to a transfer that never arrived.
        status: SubscriptionInvoiceStatus.OPEN,
        rejectedAt: new Date(),
        rejectionReason: reason,
        confirmedById: reviewedById,
        // The claimed TID is released so a corrected resubmission can use it.
        reference: null,
      },
      include: INVOICE_CONTEXT,
    });
  }

  async voidInvoice(
    invoiceId: string,
    reason: string,
    reviewedById: string,
    nextPeriod: { start: Date; end: Date },
  ): Promise<InvoiceWithContext> {
    return this.prisma.$transaction(async (tx) => {
      const invoice = await tx.subscriptionInvoice.findUniqueOrThrow({
        where: { id: invoiceId },
        include: { subscription: true },
      });

      await tx.subscriptionInvoice.update({
        where: { id: invoiceId },
        data: {
          status: SubscriptionInvoiceStatus.VOID,
          voidReason: reason,
          confirmedById: reviewedById,
        },
      });

      // A waived month still buys the vendor the period. Leaving the cycle
      // where it was would have the sweep suspend them for a bill nobody
      // intends to collect.
      await tx.vendorSubscription.update({
        where: { id: invoice.subscriptionId },
        data: {
          status: SubscriptionStatus.ACTIVE,
          currentPeriodStart: nextPeriod.start,
          currentPeriodEnd: nextPeriod.end,
          suspendedAt: null,
          suspendedByBilling: false,
          statusBeforeSuspension: null,
        },
      });

      await this.reinstate(tx, invoice.subscription);

      return tx.subscriptionInvoice.findUniqueOrThrow({
        where: { id: invoiceId },
        include: INVOICE_CONTEXT,
      });
    });
  }

  // ── The nightly sweep ──────────────────────────────────────

  async findActiveRestaurantsWithoutSubscription(
    limit: number,
  ): Promise<Array<Pick<Restaurant, 'id' | 'ownerId' | 'approvedAt'>>> {
    return this.prisma.restaurant.findMany({
      where: {
        status: RestaurantStatus.ACTIVE,
        deletedAt: null,
        subscription: { is: null },
      },
      select: { id: true, ownerId: true, approvedAt: true },
      take: limit,
    });
  }

  async findSubscriptionsNeedingInvoice(limit: number): Promise<SubscriptionWithContext[]> {
    // Column-to-column comparison, which the Prisma query API cannot express:
    // "has no invoice covering anything at or beyond the period I am currently
    // paid up to".
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT s."id"
      FROM "vendor_subscriptions" s
      WHERE s."status" = ANY (${BILLABLE}::"subscription_status"[])
        AND NOT EXISTS (
          SELECT 1
          FROM "subscription_invoices" i
          WHERE i."subscription_id" = s."id"
            AND i."period_start" >= s."current_period_end"
        )
      ORDER BY s."current_period_end" ASC
      LIMIT ${limit}
    `;

    if (rows.length === 0) {
      return [];
    }

    return this.prisma.vendorSubscription.findMany({
      where: { id: { in: rows.map((row) => row.id) } },
      include: SUBSCRIPTION_CONTEXT,
    });
  }

  async findInvoicesToRemind(
    now: Date,
    leadDays: number,
    limit: number,
  ): Promise<InvoiceWithContext[]> {
    const horizon = new Date(now.getTime() + leadDays * 24 * 60 * 60 * 1000);

    return this.prisma.subscriptionInvoice.findMany({
      where: {
        status: { in: UNPAID },
        dueAt: { gte: now, lte: horizon },
      },
      include: INVOICE_CONTEXT,
      orderBy: { dueAt: 'asc' },
      take: limit,
    });
  }

  async findInvoicesPastDue(now: Date, limit: number): Promise<InvoiceWithContext[]> {
    return this.prisma.subscriptionInvoice.findMany({
      where: {
        status: { in: UNPAID },
        dueAt: { lte: now },
        blockAt: { gt: now },
      },
      include: INVOICE_CONTEXT,
      orderBy: { dueAt: 'asc' },
      take: limit,
    });
  }

  async findInvoicesToBlock(now: Date, limit: number): Promise<InvoiceWithContext[]> {
    return this.prisma.subscriptionInvoice.findMany({
      where: {
        // OPEN only. A vendor who has submitted a transfer is waiting on us,
        // and suspending them for our own review backlog would be indefensible.
        // Rejecting that transfer returns the invoice here, which is how a
        // bogus TID buys nothing more than the time it took to check.
        status: { in: UNPAID },
        blockAt: { lte: now },
        subscription: { status: { not: SubscriptionStatus.SUSPENDED } },
      },
      include: INVOICE_CONTEXT,
      orderBy: { blockAt: 'asc' },
      take: limit,
    });
  }

  async markReminderSent(invoiceId: string, bucket: number): Promise<void> {
    await this.prisma.subscriptionInvoice.update({
      where: { id: invoiceId },
      data: { lastReminderDay: bucket },
    });
  }

  async markPastDue(subscriptionId: string): Promise<void> {
    await this.prisma.vendorSubscription.updateMany({
      where: {
        id: subscriptionId,
        status: { in: [SubscriptionStatus.TRIALING, SubscriptionStatus.ACTIVE] },
      },
      data: { status: SubscriptionStatus.PAST_DUE },
    });
  }

  async suspendForNonPayment(subscriptionId: string): Promise<SubscriptionWithContext> {
    return this.prisma.$transaction(async (tx) => {
      const subscription = await tx.vendorSubscription.findUniqueOrThrow({
        where: { id: subscriptionId },
        include: { restaurant: { select: { id: true, status: true } } },
      });

      const previous = subscription.restaurant.status;

      // Only a trading listing can be taken down. One already suspended by an
      // administrator is left exactly as it is, and `suspendedByBilling` stays
      // false so a later payment does not reinstate someone else's decision.
      if (SUSPENDABLE.includes(previous)) {
        await tx.restaurant.update({
          where: { id: subscription.restaurantId },
          data: { status: RestaurantStatus.SUSPENDED, isAcceptingOrders: false },
        });
      }

      return tx.vendorSubscription.update({
        where: { id: subscriptionId },
        data: {
          status: SubscriptionStatus.SUSPENDED,
          suspendedAt: new Date(),
          suspendedByBilling: SUSPENDABLE.includes(previous),
          statusBeforeSuspension: SUSPENDABLE.includes(previous) ? previous : null,
        },
        include: SUBSCRIPTION_CONTEXT,
      });
    });
  }

  async suspendByAdmin(
    subscriptionId: string,
    reason: string | null,
  ): Promise<SubscriptionWithContext> {
    return this.prisma.$transaction(async (tx) => {
      const subscription = await tx.vendorSubscription.findUniqueOrThrow({
        where: { id: subscriptionId },
        include: { restaurant: { select: { id: true, status: true } } },
      });

      if (SUSPENDABLE.includes(subscription.restaurant.status)) {
        await tx.restaurant.update({
          where: { id: subscription.restaurantId },
          data: {
            status: RestaurantStatus.SUSPENDED,
            isAcceptingOrders: false,
            // The field the vendor's own screen already reads back to them, so
            // a closure they can see is a closure they can act on.
            ...(reason !== null && { rejectionReason: reason }),
          },
        });
      }

      return tx.vendorSubscription.update({
        where: { id: subscriptionId },
        data: {
          status: SubscriptionStatus.SUSPENDED,
          suspendedAt: new Date(),
          // Deliberately false. This is the platform's decision rather than the
          // ledger's, and a payment must not overturn it.
          suspendedByBilling: false,
          statusBeforeSuspension: null,
        },
        include: SUBSCRIPTION_CONTEXT,
      });
    });
  }

  async reinstateByAdmin(
    subscriptionId: string,
    graceDays: number,
  ): Promise<SubscriptionWithContext> {
    return this.prisma.$transaction(async (tx) => {
      const subscription = await tx.vendorSubscription.findUniqueOrThrow({
        where: { id: subscriptionId },
      });

      const now = new Date();

      // Whatever took the listing down, an administrator is putting it back up
      // — so this does not go through `reinstate`, which deliberately only
      // reverses billing's own suspensions.
      await tx.restaurant.updateMany({
        where: { id: subscription.restaurantId, status: RestaurantStatus.SUSPENDED },
        data: {
          status: RestaurantStatus.ACTIVE,
          isAcceptingOrders: true,
          rejectionReason: null,
        },
      });

      const outstanding = await tx.subscriptionInvoice.findFirst({
        where: { subscriptionId, status: SubscriptionInvoiceStatus.OPEN },
        orderBy: { dueAt: 'asc' },
      });

      if (outstanding !== null) {
        const fresh = new Date(now.getTime() + graceDays * MS_PER_DAY);

        // Lengthened, never shortened: a vendor whose deadline is already
        // further out keeps it.
        if (outstanding.blockAt.getTime() < fresh.getTime()) {
          await tx.subscriptionInvoice.update({
            where: { id: outstanding.id },
            data: {
              blockAt: fresh,
              // Warn them again before the new deadline, rather than letting a
              // spent reminder ladder run them silently into it.
              lastReminderDay: null,
            },
          });
        }
      }

      const overdue = outstanding !== null && outstanding.dueAt.getTime() <= now.getTime();
      const trialing =
        subscription.trialEndsAt !== null && subscription.trialEndsAt.getTime() > now.getTime();

      return tx.vendorSubscription.update({
        where: { id: subscriptionId },
        data: {
          status: overdue
            ? SubscriptionStatus.PAST_DUE
            : trialing
              ? SubscriptionStatus.TRIALING
              : SubscriptionStatus.ACTIVE,
          suspendedAt: null,
          suspendedByBilling: false,
          statusBeforeSuspension: null,
        },
        include: SUBSCRIPTION_CONTEXT,
      });
    });
  }

  // ── Internals ──────────────────────────────────────────────

  /**
   * Puts a listing back up, but only one that billing itself took down.
   *
   * An administrator who suspended a restaurant over a hygiene complaint must
   * not have that reversed by the owner settling an unrelated invoice.
   */
  private async reinstate(
    tx: Prisma.TransactionClient,
    subscription: {
      restaurantId: string;
      suspendedByBilling: boolean;
      statusBeforeSuspension: RestaurantStatus | null;
    },
  ): Promise<void> {
    if (!subscription.suspendedByBilling) {
      return;
    }

    const restore = subscription.statusBeforeSuspension ?? RestaurantStatus.ACTIVE;

    await tx.restaurant.updateMany({
      where: { id: subscription.restaurantId, status: RestaurantStatus.SUSPENDED },
      data: {
        status: restore,
        // A listing that comes back as ACTIVE takes orders again; one restored
        // to the owner's own pause stays paused, because that was their choice.
        isAcceptingOrders: restore === RestaurantStatus.ACTIVE,
      },
    });
  }

  private async nextInvoiceNumber(tx: Prisma.TransactionClient): Promise<string> {
    const [row] = await tx.$queryRaw<Array<{ value: bigint }>>`
      SELECT nextval('subscription_invoice_seq') AS value
    `;

    const today = new Date();
    const stamp = [
      String(today.getFullYear()).slice(2),
      String(today.getMonth() + 1).padStart(2, '0'),
      String(today.getDate()).padStart(2, '0'),
    ].join('');

    return `SUB-${stamp}-${String(Number(row?.value ?? 1)).padStart(4, '0')}`;
  }
}
