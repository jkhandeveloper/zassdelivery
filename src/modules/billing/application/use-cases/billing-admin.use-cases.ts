import { Injectable } from '@nestjs/common';
import { NotificationType, SubscriptionInvoiceStatus, SubscriptionStatus } from '@prisma/client';

import {
  BusinessRuleViolationException,
  ResourceNotFoundException,
} from '@/common/exceptions/domain.exception';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import type { PaginatedResult } from '@/common/interfaces/paginated-result.interface';
import { NotifyService } from '@/modules/notifications/application/use-cases/notify.service';

import { BillingRepository } from '../../domain/repositories/billing.repository';
import {
  toInvoiceDto,
  toSubscriptionDto,
  type SubscriptionDto,
  type SubscriptionInvoiceDto,
} from '../dto/billing-response.dto';
import type {
  ListInvoicesQueryDto,
  ListSubscriptionsQueryDto,
  RecordPaymentDto,
  RejectTransferDto,
  SetMonthlyFeeDto,
  SuspendVendorDto,
  UpdatePaymentRecordDto,
  VoidInvoiceDto,
} from '../dto/billing.dto';
import { BILLING_GRACE_DAYS } from '../../domain/services/billing-schedule';
import { BillingPricingService } from '../services/billing-pricing.service';

/** Invoices an administrator may still act on. */
const ACTIONABLE: SubscriptionInvoiceStatus[] = [
  SubscriptionInvoiceStatus.OPEN,
  SubscriptionInvoiceStatus.PENDING_REVIEW,
];

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

@Injectable()
export class ListSubscriptionsUseCase {
  constructor(
    private readonly billing: BillingRepository,
    private readonly pricing: BillingPricingService,
  ) {}

  async execute(query: ListSubscriptionsQueryDto): Promise<PaginatedResult<SubscriptionDto>> {
    const page = await this.billing.findSubscriptions({
      page: query.page,
      limit: query.limit,
      status: query.status,
      search: query.search,
    });

    // Read once for the whole page rather than per row: every vendor on the
    // standard rate resolves to the same number.
    const defaultFee = await this.pricing.defaultMonthlyFee();

    return {
      items: page.items.map((subscription) =>
        toSubscriptionDto(subscription, {
          effectiveFee:
            subscription.monthlyFee === null ? defaultFee : Number(subscription.monthlyFee),
          includeOwner: true,
        }),
      ),
      meta: page.meta,
    };
  }
}

@Injectable()
export class ListBillingInvoicesUseCase {
  constructor(private readonly billing: BillingRepository) {}

  async execute(query: ListInvoicesQueryDto): Promise<PaginatedResult<SubscriptionInvoiceDto>> {
    const page = await this.billing.findInvoices({
      page: query.page,
      limit: query.limit,
      status: query.status,
      restaurantId: query.restaurantId,
      search: query.search,
      from: query.from,
      to: query.to,
    });

    return {
      items: page.items.map((invoice) => toInvoiceDto(invoice, { includeOwner: true })),
      meta: page.meta,
    };
  }
}

@Injectable()
export class ConfirmTransferUseCase {
  constructor(
    private readonly billing: BillingRepository,
    private readonly notify: NotifyService,
  ) {}

  /**
   * Agrees that the vendor's transfer arrived, and settles everything it buys.
   *
   * `OPEN` is accepted as well as `PENDING_REVIEW`: a vendor who phones the
   * office rather than using the app has still paid, and refusing to record it
   * would suspend a paid-up restaurant on a technicality.
   */
  async execute(invoiceId: string, actor: AuthenticatedUser): Promise<SubscriptionInvoiceDto> {
    const invoice = await this.billing.findInvoiceById(invoiceId);

    if (invoice === null) {
      throw new ResourceNotFoundException('Invoice', invoiceId);
    }

    if (invoice.status === SubscriptionInvoiceStatus.PAID) {
      // Not an error worth failing on — two administrators working the same
      // queue is normal, and the repository settles this idempotently.
      return toInvoiceDto(invoice, { includeOwner: true });
    }

    if (!ACTIONABLE.includes(invoice.status)) {
      throw new BusinessRuleViolationException(
        `An invoice that is ${invoice.status.toLowerCase()} cannot be confirmed.`,
      );
    }

    const settled = await this.billing.confirmInvoice({
      invoiceId: invoice.id,
      confirmedById: actor.id,
      // The invoice buys its own period, so that is exactly what the
      // subscription rolls onto.
      nextPeriodStart: invoice.periodStart,
      nextPeriodEnd: invoice.periodEnd,
    });

    await this.notify.notify({
      userId: invoice.subscription.ownerId,
      type: NotificationType.SYSTEM,
      title: 'Payment received',
      body:
        `We've confirmed your payment for ${invoice.restaurant.name}. ` +
        `You're paid up until ${formatDate(invoice.periodEnd)}.`,
      data: { invoiceId: invoice.id, restaurantId: invoice.restaurantId, kind: 'billing' },
    });

    return toInvoiceDto(settled, { includeOwner: true });
  }
}

@Injectable()
export class RejectTransferUseCase {
  constructor(
    private readonly billing: BillingRepository,
    private readonly notify: NotifyService,
  ) {}

  async execute(
    invoiceId: string,
    dto: RejectTransferDto,
    actor: AuthenticatedUser,
  ): Promise<SubscriptionInvoiceDto> {
    const invoice = await this.billing.findInvoiceById(invoiceId);

    if (invoice === null) {
      throw new ResourceNotFoundException('Invoice', invoiceId);
    }

    if (invoice.status !== SubscriptionInvoiceStatus.PENDING_REVIEW) {
      throw new BusinessRuleViolationException(
        'There is no transfer awaiting review on this invoice.',
      );
    }

    const rejected = await this.billing.rejectTransfer(invoice.id, dto.reason, actor.id);

    await this.notify.notify({
      userId: invoice.subscription.ownerId,
      type: NotificationType.SYSTEM,
      title: "We couldn't confirm your payment",
      body:
        `${dto.reason} Your invoice ${invoice.invoiceNumber} is still unpaid — ` +
        `${invoice.restaurant.name} closes on ${formatDate(invoice.blockAt)} if it stays that way.`,
      data: { invoiceId: invoice.id, restaurantId: invoice.restaurantId, kind: 'billing' },
    });

    return toInvoiceDto(rejected, { includeOwner: true });
  }
}

@Injectable()
export class VoidInvoiceUseCase {
  constructor(
    private readonly billing: BillingRepository,
    private readonly notify: NotifyService,
  ) {}

  /** Writes a month off. The vendor still gets the period it covered. */
  async execute(
    invoiceId: string,
    dto: VoidInvoiceDto,
    actor: AuthenticatedUser,
  ): Promise<SubscriptionInvoiceDto> {
    const invoice = await this.billing.findInvoiceById(invoiceId);

    if (invoice === null) {
      throw new ResourceNotFoundException('Invoice', invoiceId);
    }

    if (invoice.status === SubscriptionInvoiceStatus.PAID) {
      throw new BusinessRuleViolationException(
        'This invoice has already been paid. Refund it rather than waiving it.',
      );
    }

    if (invoice.status === SubscriptionInvoiceStatus.VOID) {
      throw new BusinessRuleViolationException('This invoice has already been waived.');
    }

    const voided = await this.billing.voidInvoice(invoice.id, dto.reason, actor.id, {
      start: invoice.periodStart,
      end: invoice.periodEnd,
    });

    await this.notify.notify({
      userId: invoice.subscription.ownerId,
      type: NotificationType.SYSTEM,
      title: 'This month is on us',
      body:
        `Invoice ${invoice.invoiceNumber} for ${invoice.restaurant.name} has been waived. ` +
        `Nothing to pay until ${formatDate(invoice.periodEnd)}.`,
      data: { invoiceId: invoice.id, restaurantId: invoice.restaurantId, kind: 'billing' },
    });

    return toInvoiceDto(voided, { includeOwner: true });
  }
}

@Injectable()
export class SetMonthlyFeeUseCase {
  constructor(
    private readonly billing: BillingRepository,
    private readonly pricing: BillingPricingService,
    private readonly notify: NotifyService,
  ) {}

  /**
   * Puts one vendor on their own rate, or back on the platform's.
   *
   * The new figure re-prices whatever they currently owe rather than waiting
   * for next month, and they are told what it is — a rate a vendor finds out
   * about when their payment comes up short is a rate we never agreed.
   */
  async execute(subscriptionId: string, dto: SetMonthlyFeeDto): Promise<SubscriptionDto> {
    const existing = await this.billing.findSubscriptionById(subscriptionId);

    if (existing === null) {
      throw new ResourceNotFoundException('Subscription', subscriptionId);
    }

    const updated = await this.billing.setMonthlyFee(subscriptionId, dto.monthlyFee);
    const effectiveFee = await this.pricing.effectiveFee(updated);

    const repriced = await this.billing.repriceOpenInvoice(subscriptionId, effectiveFee);

    await this.notify.notify({
      userId: updated.ownerId,
      type: NotificationType.SYSTEM,
      title: 'Your monthly platform fee has changed',
      body:
        `${updated.restaurant.name} now pays PKR ${effectiveFee} a month.` +
        (repriced === null
          ? ' It applies from your next invoice.'
          : ` Invoice ${repriced.invoiceNumber}, due ${formatDate(repriced.dueAt)}, has been updated to match.`),
      data: { kind: 'billing', restaurantId: updated.restaurantId },
    });

    return toSubscriptionDto(updated, { effectiveFee, includeOwner: true });
  }
}

@Injectable()
export class RecordPaymentUseCase {
  constructor(
    private readonly billing: BillingRepository,
    private readonly notify: NotifyService,
  ) {}

  /**
   * Enters a payment the platform received, without waiting for the vendor to
   * report it.
   *
   * For the money that arrives by phone call, by bank transfer, or in cash at
   * the office — all of which are real, and none of which the vendor's own
   * screen knows about. It settles through exactly the same path as a confirmed
   * transfer, so the ledger, the period roll and the reinstatement are identical.
   */
  async execute(
    invoiceId: string,
    dto: RecordPaymentDto,
    actor: AuthenticatedUser,
  ): Promise<SubscriptionInvoiceDto> {
    const invoice = await this.billing.findInvoiceById(invoiceId);

    if (invoice === null) {
      throw new ResourceNotFoundException('Invoice', invoiceId);
    }

    if (invoice.status === SubscriptionInvoiceStatus.PAID) {
      throw new BusinessRuleViolationException(
        'This invoice is already paid. Correct its details rather than recording it twice.',
      );
    }

    if (invoice.status === SubscriptionInvoiceStatus.VOID) {
      throw new BusinessRuleViolationException('This invoice was waived, so nothing is owed.');
    }

    const settled = await this.billing.confirmInvoice({
      invoiceId: invoice.id,
      confirmedById: actor.id,
      nextPeriodStart: invoice.periodStart,
      nextPeriodEnd: invoice.periodEnd,
      channel: dto.channel,
      reference: dto.reference ?? null,
      paidAt: dto.paidAt,
    });

    await this.notify.notify({
      userId: invoice.subscription.ownerId,
      type: NotificationType.SYSTEM,
      title: 'Payment recorded',
      body:
        `We've recorded your payment for ${invoice.restaurant.name}. ` +
        `You're paid up until ${formatDate(invoice.periodEnd)}.`,
      data: { invoiceId: invoice.id, restaurantId: invoice.restaurantId, kind: 'billing' },
    });

    return toInvoiceDto(settled, { includeOwner: true });
  }
}

@Injectable()
export class UpdatePaymentRecordUseCase {
  constructor(private readonly billing: BillingRepository) {}

  /** Fixes a mistyped transaction ID, wrong wallet or wrong date after the fact. */
  async execute(invoiceId: string, dto: UpdatePaymentRecordDto): Promise<SubscriptionInvoiceDto> {
    const invoice = await this.billing.findInvoiceById(invoiceId);

    if (invoice === null) {
      throw new ResourceNotFoundException('Invoice', invoiceId);
    }

    if (invoice.status !== SubscriptionInvoiceStatus.PAID) {
      throw new BusinessRuleViolationException(
        'There is no payment on this invoice to correct yet.',
      );
    }

    const updated = await this.billing.updatePaymentRecord(invoice.id, {
      channel: dto.channel,
      reference: dto.reference,
      paidAt: dto.paidAt,
    });

    return toInvoiceDto(updated, { includeOwner: true });
  }
}

@Injectable()
export class SuspendVendorUseCase {
  constructor(
    private readonly billing: BillingRepository,
    private readonly pricing: BillingPricingService,
    private readonly notify: NotifyService,
  ) {}

  /**
   * Closes a vendor's account by hand.
   *
   * Separate from the sweep's own suspension, and recorded differently: this is
   * the platform's decision, so paying an invoice will not reopen it. Only an
   * administrator can undo an administrator.
   */
  async execute(
    subscriptionId: string,
    dto: SuspendVendorDto,
    _actor: AuthenticatedUser,
  ): Promise<SubscriptionDto> {
    const existing = await this.billing.findSubscriptionById(subscriptionId);

    if (existing === null) {
      throw new ResourceNotFoundException('Subscription', subscriptionId);
    }

    const updated = await this.billing.suspendByAdmin(subscriptionId, dto.reason);
    const effectiveFee = await this.pricing.effectiveFee(updated);

    await this.notify.notify({
      userId: updated.ownerId,
      type: NotificationType.SYSTEM,
      title: `${updated.restaurant.name} has been closed`,
      body: `${dto.reason} Your listing is not taking orders until this is resolved.`,
      data: { kind: 'billing', restaurantId: updated.restaurantId },
    });

    return toSubscriptionDto(updated, { effectiveFee, includeOwner: true });
  }
}

@Injectable()
export class ReinstateVendorUseCase {
  constructor(
    private readonly billing: BillingRepository,
    private readonly pricing: BillingPricingService,
    private readonly notify: NotifyService,
  ) {}

  /**
   * Reopens a vendor's account, whatever closed it.
   *
   * An invoice still outstanding keeps its balance but gets a fresh grace
   * window: reopening a restaurant only for the nightly sweep to close it again
   * before breakfast would be worse than leaving it shut.
   */
  async execute(subscriptionId: string): Promise<SubscriptionDto> {
    const existing = await this.billing.findSubscriptionById(subscriptionId);

    if (existing === null) {
      throw new ResourceNotFoundException('Subscription', subscriptionId);
    }

    const updated = await this.billing.reinstateByAdmin(subscriptionId, BILLING_GRACE_DAYS);
    const effectiveFee = await this.pricing.effectiveFee(updated);

    const owes = updated.status === SubscriptionStatus.PAST_DUE;

    await this.notify.notify({
      userId: updated.ownerId,
      type: NotificationType.SYSTEM,
      title: `${updated.restaurant.name} is open again`,
      body: owes
        ? `You're taking orders again. There's still a platform fee outstanding — you have ` +
          `${BILLING_GRACE_DAYS} days to settle it before the listing closes again.`
        : "You're taking orders again.",
      data: { kind: 'billing', restaurantId: updated.restaurantId },
    });

    return toSubscriptionDto(updated, { effectiveFee, includeOwner: true });
  }
}
