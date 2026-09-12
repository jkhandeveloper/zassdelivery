import { Inject, Injectable, type LoggerService } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { NotificationType } from '@prisma/client';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';

import { NotifyService } from '@/modules/notifications/application/use-cases/notify.service';
import {
  RestaurantEvents,
  type RestaurantApprovedPayload,
} from '@/modules/restaurants/domain/events/restaurant.events';

import { BillingRepository } from '../../domain/repositories/billing.repository';
import { trialPeriod } from '../../domain/services/billing-schedule';

/**
 * Starts a vendor's free month the day their listing goes live.
 *
 * Approval is the trigger rather than registration: an unapproved listing
 * cannot take an order, and charging for a month a vendor was never allowed to
 * trade in is how a platform loses them before it earns anything.
 *
 * Nothing here throws. The approval has already committed, and a vendor must
 * never be left unapproved because billing failed — the nightly sweep opens a
 * subscription for any live listing that lacks one, so a lost event costs a day,
 * not a subscription.
 */
@Injectable()
export class RestaurantApprovedListener {
  private readonly context = RestaurantApprovedListener.name;

  constructor(
    private readonly billing: BillingRepository,
    private readonly notify: NotifyService,
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: LoggerService,
  ) {}

  @OnEvent(RestaurantEvents.approved, { async: true })
  async onApproved(payload: RestaurantApprovedPayload): Promise<void> {
    try {
      const existing = await this.billing.findSubscriptionForRestaurant(payload.restaurantId);

      // A re-approval — suspended, then restored — must not restart the trial
      // and hand the vendor another free month.
      if (existing !== null) {
        return;
      }

      const trial = trialPeriod(new Date(payload.approvedAt));

      const subscription = await this.billing.createSubscription({
        restaurantId: payload.restaurantId,
        ownerId: payload.ownerId,
        trialStart: trial.periodStart,
        trialEnd: trial.periodEnd,
      });

      // Recorded rather than skipped, so the vendor's billing history reads
      // continuously from the day they went live instead of starting at the
      // first month they were charged for.
      await this.billing.createInvoice({
        subscriptionId: subscription.id,
        restaurantId: payload.restaurantId,
        amount: 0,
        currency: subscription.currency,
        periodStart: trial.periodStart,
        periodEnd: trial.periodEnd,
        dueAt: trial.dueAt,
        blockAt: trial.blockAt,
        isTrial: true,
      });

      await this.notify.notify({
        userId: payload.ownerId,
        type: NotificationType.SYSTEM,
        title: 'Your first month is free',
        body:
          `${payload.restaurantName} is live. Your first month on ZassDelivery costs nothing — ` +
          `your first platform fee falls due on ${trial.periodEnd.toLocaleDateString('en-GB', {
            day: 'numeric',
            month: 'long',
            year: 'numeric',
          })}.`,
        data: { kind: 'billing', restaurantId: payload.restaurantId },
      });
    } catch (error) {
      this.logger.error?.(
        `Could not open a subscription for restaurant ${payload.restaurantId}: ${(error as Error).message}`,
        this.context,
      );
    }
  }
}
