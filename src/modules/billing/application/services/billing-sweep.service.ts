import { Inject, Injectable, type LoggerService } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { NotificationType } from '@prisma/client';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';

import { NotifyService } from '@/modules/notifications/application/use-cases/notify.service';

import {
  BillingRepository,
  type InvoiceWithContext,
} from '../../domain/repositories/billing.repository';
import {
  BILLING_GRACE_DAYS,
  REMINDER_LEAD_DAYS,
  daysUntil,
  periodFrom,
  shouldRemind,
  trialPeriod,
} from '../../domain/services/billing-schedule';
import { BillingPricingService } from './billing-pricing.service';

/** How much the sweep will take on in one pass, per stage. */
const BATCH_SIZE = 200;

/**
 * The marker written to `lastReminderDay` once the overdue notice has gone out.
 *
 * Zero sits below every reminder bucket, so `shouldRemind` will not fire again
 * for this invoice — which is what stops a vendor inside the grace window being
 * told they are overdue once a day for three days running.
 */
const PAST_DUE_MARKER = 0;

const LONGEST_LEAD = Math.max(...REMINDER_LEAD_DAYS);

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

/**
 * The nightly pass that keeps every vendor's subscription honest.
 *
 * Five stages, each independent and each swallowing its own failures: a vendor
 * who cannot be notified must still be invoiced, and one bad row must never
 * stop the platform billing everybody else. Nothing here throws.
 *
 * It runs daily rather than continuously because everything it decides is
 * measured in days. The only cost of a missed night is that the next pass does
 * two nights' work, which every stage is written to tolerate — reminders are
 * chosen by how much time is actually left, not by which night it is.
 */
@Injectable()
export class BillingSweepService {
  private readonly context = BillingSweepService.name;

  /**
   * Guards against a slow sweep overlapping the next night's. `@Cron` fires on
   * a timer, not on completion.
   */
  private sweeping = false;

  constructor(
    private readonly billing: BillingRepository,
    private readonly pricing: BillingPricingService,
    private readonly notify: NotifyService,
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: LoggerService,
  ) {}

  /**
   * Two in the morning: after the kitchens have closed and before anyone opens.
   * A restaurant that is going to be suspended should find out overnight, not
   * halfway through a lunch service.
   */
  @Cron(CronExpression.EVERY_DAY_AT_2AM, { name: 'billing-sweep' })
  async sweep(): Promise<void> {
    if (this.sweeping) {
      return;
    }

    this.sweeping = true;
    const now = new Date();

    try {
      await this.runStage('backfill', () => this.backfillSubscriptions(now));
      await this.runStage('issue', () => this.issueInvoices());
      await this.runStage('remind', () => this.sendReminders(now));
      await this.runStage('past-due', () => this.markPastDue(now));
      await this.runStage('suspend', () => this.suspendUnpaid(now));
    } finally {
      this.sweeping = false;
    }
  }

  /** One stage's failure is logged and contained, never propagated. */
  private async runStage(name: string, stage: () => Promise<number>): Promise<void> {
    try {
      const touched = await stage();

      if (touched > 0) {
        this.logger.log?.(`Billing sweep: ${name} handled ${touched}`, this.context);
      }
    } catch (error) {
      this.logger.error?.(
        `Billing sweep stage "${name}" failed: ${(error as Error).message}`,
        this.context,
      );
    }
  }

  /**
   * Opens a subscription for any live listing that lacks one.
   *
   * The backfill for restaurants that were already trading when billing arrived,
   * and the safety net for an approval whose event was missed. Their free month
   * starts now rather than at their original approval, because charging someone
   * for a period that elapsed before the platform had billing would be indefensible.
   */
  private async backfillSubscriptions(now: Date): Promise<number> {
    const restaurants = await this.billing.findActiveRestaurantsWithoutSubscription(BATCH_SIZE);

    for (const restaurant of restaurants) {
      const trial = trialPeriod(now);

      const subscription = await this.billing.createSubscription({
        restaurantId: restaurant.id,
        ownerId: restaurant.ownerId,
        trialStart: trial.periodStart,
        trialEnd: trial.periodEnd,
      });

      await this.billing.createInvoice({
        subscriptionId: subscription.id,
        restaurantId: restaurant.id,
        amount: 0,
        currency: subscription.currency,
        periodStart: trial.periodStart,
        periodEnd: trial.periodEnd,
        dueAt: trial.dueAt,
        blockAt: trial.blockAt,
        isTrial: true,
      });
    }

    return restaurants.length;
  }

  /**
   * Keeps exactly one unpaid invoice ahead of every vendor.
   *
   * Raised as soon as the current period begins rather than a few days before
   * it ends, so a vendor who wants to pay early can, and so every reminder has
   * a real invoice number to quote.
   */
  private async issueInvoices(): Promise<number> {
    const subscriptions = await this.billing.findSubscriptionsNeedingInvoice(BATCH_SIZE);

    for (const subscription of subscriptions) {
      const period = periodFrom(subscription.currentPeriodEnd);
      const amount = await this.pricing.effectiveFee(subscription);

      await this.billing.createInvoice({
        subscriptionId: subscription.id,
        restaurantId: subscription.restaurantId,
        amount,
        currency: subscription.currency,
        periodStart: period.periodStart,
        periodEnd: period.periodEnd,
        dueAt: period.dueAt,
        blockAt: period.blockAt,
        isTrial: false,
      });
    }

    return subscriptions.length;
  }

  /** The 7, 3 and 1 day warnings. */
  private async sendReminders(now: Date): Promise<number> {
    const invoices = await this.billing.findInvoicesToRemind(now, LONGEST_LEAD, BATCH_SIZE);
    let sent = 0;

    for (const invoice of invoices) {
      const bucket = shouldRemind(invoice.dueAt, now, invoice.lastReminderDay);

      if (bucket === null) {
        continue;
      }

      // The real number of days left, never the bucket: if a sweep was missed
      // and seven days became two, the vendor must be told two.
      const remaining = Math.max(daysUntil(invoice.dueAt, now), 0);

      await this.tell(
        invoice,
        remaining === 0
          ? 'Your platform fee is due today'
          : `Your platform fee is due in ${plural(remaining, 'day')}`,
        `${invoice.restaurant.name} — ${invoice.currency} ${Number(invoice.amount)} for the month ` +
          `from ${formatDate(invoice.periodStart)}. Pay by ${formatDate(invoice.dueAt)} to stay open. ` +
          `Invoice ${invoice.invoiceNumber}.`,
      );

      await this.billing.markReminderSent(invoice.id, bucket);
      sent += 1;
    }

    return sent;
  }

  /**
   * Past the due date and into grace.
   *
   * The listing stays up — this is the warning that it will not for long, and
   * it names the date so nobody is surprised.
   */
  private async markPastDue(now: Date): Promise<number> {
    const invoices = await this.billing.findInvoicesPastDue(now, BATCH_SIZE);
    let touched = 0;

    for (const invoice of invoices) {
      await this.billing.markPastDue(invoice.subscriptionId);

      if (invoice.lastReminderDay === PAST_DUE_MARKER) {
        continue;
      }

      const left = Math.max(daysUntil(invoice.blockAt, now), 0);

      await this.tell(
        invoice,
        'Your platform fee is overdue',
        `${invoice.restaurant.name} is still open, but invoice ${invoice.invoiceNumber} ` +
          `(${invoice.currency} ${Number(invoice.amount)}) was due on ${formatDate(invoice.dueAt)}. ` +
          `Pay within ${plural(left, 'day')} — on ${formatDate(invoice.blockAt)} the listing closes automatically.`,
      );

      await this.billing.markReminderSent(invoice.id, PAST_DUE_MARKER);
      touched += 1;
    }

    return touched;
  }

  /**
   * Grace exhausted. The listing comes down.
   *
   * Unless the platform has published nowhere to pay. A vendor cannot settle an
   * invoice against an empty list of QR codes, and closing a restaurant for
   * failing to do the impossible is indefensible — so this stage stands down
   * entirely until somebody configures an account. Every other stage keeps
   * running, so the invoices, the reminders and the overdue notices are all
   * still there the moment it is.
   */
  private async suspendUnpaid(now: Date): Promise<number> {
    const payTo = await this.pricing.payToQrCodes();

    if (payTo.length === 0) {
      this.logger.warn?.(
        'Nobody was suspended: the platform has published no payment QR codes, so no ' +
          'vendor has anywhere to send their fee.',
        this.context,
      );

      return 0;
    }

    const invoices = await this.billing.findInvoicesToBlock(now, BATCH_SIZE);

    for (const invoice of invoices) {
      await this.billing.suspendForNonPayment(invoice.subscriptionId);

      await this.tell(
        invoice,
        `${invoice.restaurant.name} has been closed`,
        `Invoice ${invoice.invoiceNumber} (${invoice.currency} ${Number(invoice.amount)}) went unpaid ` +
          `for ${plural(BILLING_GRACE_DAYS, 'day')} after its due date, so your listing is no longer ` +
          `taking orders. Pay it and we'll reopen you as soon as we've confirmed the transfer.`,
      );
    }

    return invoices.length;
  }

  /**
   * Tells the owner, and never lets that be the thing that fails the sweep.
   *
   * The billing decision has already been written. A push that does not land is
   * a support call; a suspension rolled back because Firebase was slow is a
   * restaurant taking orders it is not entitled to.
   */
  private async tell(invoice: InvoiceWithContext, title: string, body: string): Promise<void> {
    try {
      await this.notify.notify({
        userId: invoice.subscription.ownerId,
        type: NotificationType.SYSTEM,
        title,
        body,
        data: {
          kind: 'billing',
          invoiceId: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          restaurantId: invoice.restaurantId,
        },
      });
    } catch (error) {
      this.logger.warn?.(
        `Could not notify owner of invoice ${invoice.invoiceNumber}: ${(error as Error).message}`,
        this.context,
      );
    }
  }
}
