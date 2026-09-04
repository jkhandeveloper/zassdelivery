import { Inject, Injectable, type LoggerService } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Cron, CronExpression } from '@nestjs/schedule';
import { OrderStatus } from '@prisma/client';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';

import { BusinessRuleViolationException } from '@/common/exceptions/domain.exception';
import {
  OrderEvents,
  type OrderStatusEventPayload,
} from '@/modules/orders/domain/events/order.events';

import { AssignmentRepository } from '../../domain/repositories/assignment.repository';
import { AssignOrderUseCase, ExpireOffersUseCase } from '../use-cases/dispatch.use-cases';

/**
 * Statuses at which an order is waiting for a rider.
 *
 * The same set `AssignOrderUseCase` accepts: dispatch opens when the kitchen
 * confirms, so a rider is riding to the restaurant while the food cooks rather
 * than setting off once it is already going cold.
 */
const DISPATCHABLE_STATUSES: OrderStatus[] = [
  OrderStatus.CONFIRMED,
  OrderStatus.PREPARING,
  OrderStatus.READY_FOR_PICKUP,
];

/**
 * How many orders one sweep will try to place.
 *
 * A cap rather than the whole backlog: each attempt is a handful of queries,
 * and an unbounded sweep during a rush would hold the database for longer than
 * the interval it runs on.
 */
const SWEEP_BATCH_SIZE = 20;

/**
 * Gets orders into riders' hands without anybody pressing a button.
 *
 * Two triggers, deliberately, because each covers the other's blind spot. The
 * event hook is the fast path: the kitchen accepts and the nearest rider's
 * phone goes off in the same second. The sweep is the safety net, and it is the
 * one that does the real work — an order placed when every rider is busy has no
 * event left to fire, and would otherwise sit unassigned until somebody noticed
 * it on the dispatch board. Rejections and expired offers land in exactly the
 * same state, so re-offering is the same code path as offering, not a separate
 * retry mechanism.
 *
 * Nothing here throws. Dispatch is downstream of an order that is already
 * committed, and "no rider is free right now" is the normal state of a delivery
 * platform at lunchtime, not an error — the sweep will simply try again.
 */
@Injectable()
export class DispatchCoordinator {
  private readonly context = DispatchCoordinator.name;

  /**
   * Guards against a slow sweep overlapping the next tick.
   *
   * `@Cron` fires on a timer, not on completion, so without this a sweep that
   * takes longer than its interval would run alongside itself and offer the
   * same order twice.
   */
  private sweeping = false;

  constructor(
    private readonly assignments: AssignmentRepository,
    private readonly assign: AssignOrderUseCase,
    private readonly expireOffers: ExpireOffersUseCase,
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: LoggerService,
  ) {}

  /**
   * The fast path: an order the restaurant has just accepted.
   *
   * Narrowed to the *transition into* CONFIRMED rather than to the status
   * itself, so the later moves through PREPARING and READY_FOR_PICKUP — which
   * leave the order equally dispatchable — do not each fire another attempt at
   * an order that already has an offer open.
   */
  @OnEvent(OrderEvents.statusChanged, { async: true })
  async onOrderConfirmed(event: OrderStatusEventPayload): Promise<void> {
    if (event.status !== OrderStatus.CONFIRMED) {
      return;
    }

    await this.offer(event.orderId, event.orderNumber);
  }

  /**
   * The safety net, and the retry.
   *
   * Ten seconds is chosen against the offer window rather than against load: an
   * offer lasts sixty seconds by default, so a rider who ignores one costs the
   * order about a minute, and a sweep an order of magnitude faster than that
   * keeps the sweep itself out of the critical path.
   */
  @Cron(CronExpression.EVERY_10_SECONDS, { name: 'dispatch-sweep' })
  async sweep(): Promise<void> {
    if (this.sweeping) {
      return;
    }

    this.sweeping = true;

    try {
      // Expiring first is what frees the orders this sweep then picks up: an
      // offer nobody answered still counts as live until it is marked EXPIRED.
      const { expired } = await this.expireOffers.execute();

      if (expired > 0) {
        this.logger.log?.(`Expired ${expired} unanswered offer(s)`, this.context);
      }

      const waiting = await this.assignments.findOrderIdsAwaitingDispatch(
        DISPATCHABLE_STATUSES,
        SWEEP_BATCH_SIZE,
      );

      // Sequential, not Promise.all: two offers going out at the same moment
      // would rank against the same pool of riders and both pick the same one,
      // and the second would then fail on the partial unique index.
      for (const orderId of waiting) {
        await this.offer(orderId, orderId);
      }
    } catch (error) {
      this.logger.error?.(
        `Dispatch sweep failed: ${(error as Error).message}`,
        (error as Error).stack,
        this.context,
      );
    } finally {
      this.sweeping = false;
    }
  }

  /**
   * One attempt, with every expected failure swallowed.
   *
   * "No rider available" and "this order already has one" are both ordinary
   * outcomes of a race the sweep is designed to lose safely, so they are logged
   * at debug and nothing more. Anything else is a genuine surprise and is
   * logged as an error — but still never rethrown, because the caller is either
   * an event listener with nobody to report to or a timer.
   */
  private async offer(orderId: string, label: string): Promise<void> {
    try {
      const assignment = await this.assign.execute(orderId, {}, null);

      this.logger.log?.(
        `Order ${label} offered to a rider (assignment ${assignment.id}, ` +
          `expires ${assignment.expiresAt.toISOString()})`,
        this.context,
      );
    } catch (error) {
      if (error instanceof BusinessRuleViolationException) {
        this.logger.debug?.(
          `Order ${label} not dispatched: ${(error as Error).message}`,
          this.context,
        );
        return;
      }

      this.logger.error?.(
        `Order ${label} could not be dispatched: ${(error as Error).message}`,
        (error as Error).stack,
        this.context,
      );
    }
  }
}
