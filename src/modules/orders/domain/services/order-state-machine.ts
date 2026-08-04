import { ActorType, OrderStatus } from '@prisma/client';

import { BusinessRuleViolationException } from '@/common/exceptions/domain.exception';

/** Who is permitted to drive a given transition. */
export interface TransitionRule {
  to: OrderStatus;
  actors: ActorType[];
  /** Shown in the timeline and in the customer-facing status text. */
  label: string;
}

/**
 * The order lifecycle, declared as data.
 *
 * Encoding it as a table rather than as scattered `if` statements means the
 * whole flow is readable in one place, and an illegal jump — a rider marking an
 * order delivered before the kitchen ever confirmed it, say — fails loudly
 * instead of silently corrupting the history.
 *
 * `SYSTEM` appears as an actor wherever an automated process may act: payment
 * timeouts, auto-rejection of unconfirmed orders, dispatch failures.
 */
export const ORDER_TRANSITIONS: Record<OrderStatus, TransitionRule[]> = {
  [OrderStatus.PENDING_PAYMENT]: [
    {
      to: OrderStatus.PLACED,
      actors: [ActorType.SYSTEM, ActorType.CUSTOMER],
      label: 'Payment received',
    },
    {
      to: OrderStatus.CANCELLED,
      actors: [ActorType.CUSTOMER, ActorType.SYSTEM, ActorType.ADMIN],
      label: 'Cancelled',
    },
    { to: OrderStatus.FAILED, actors: [ActorType.SYSTEM], label: 'Payment failed' },
  ],

  [OrderStatus.PLACED]: [
    {
      to: OrderStatus.CONFIRMED,
      actors: [ActorType.RESTAURANT, ActorType.ADMIN],
      label: 'Accepted by restaurant',
    },
    {
      to: OrderStatus.REJECTED,
      actors: [ActorType.RESTAURANT, ActorType.ADMIN],
      label: 'Rejected by restaurant',
    },
    {
      to: OrderStatus.CANCELLED,
      actors: [ActorType.CUSTOMER, ActorType.ADMIN, ActorType.SYSTEM],
      label: 'Cancelled',
    },
  ],

  [OrderStatus.CONFIRMED]: [
    {
      to: OrderStatus.PREPARING,
      actors: [ActorType.RESTAURANT, ActorType.ADMIN],
      label: 'Kitchen started',
    },
    {
      to: OrderStatus.CANCELLED,
      actors: [ActorType.ADMIN, ActorType.RESTAURANT],
      label: 'Cancelled',
    },
  ],

  [OrderStatus.PREPARING]: [
    {
      to: OrderStatus.READY_FOR_PICKUP,
      actors: [ActorType.RESTAURANT, ActorType.ADMIN],
      label: 'Ready for pickup',
    },
    { to: OrderStatus.CANCELLED, actors: [ActorType.ADMIN], label: 'Cancelled' },
  ],

  [OrderStatus.READY_FOR_PICKUP]: [
    {
      to: OrderStatus.PICKED_UP,
      actors: [ActorType.DRIVER, ActorType.ADMIN],
      label: 'Collected by rider',
    },
    { to: OrderStatus.CANCELLED, actors: [ActorType.ADMIN], label: 'Cancelled' },
  ],

  [OrderStatus.PICKED_UP]: [
    {
      to: OrderStatus.ON_THE_WAY,
      actors: [ActorType.DRIVER, ActorType.ADMIN],
      label: 'On the way',
    },
    {
      to: OrderStatus.FAILED,
      actors: [ActorType.ADMIN, ActorType.SYSTEM],
      label: 'Delivery failed',
    },
  ],

  [OrderStatus.ON_THE_WAY]: [
    { to: OrderStatus.DELIVERED, actors: [ActorType.DRIVER, ActorType.ADMIN], label: 'Delivered' },
    {
      to: OrderStatus.FAILED,
      actors: [ActorType.DRIVER, ActorType.ADMIN, ActorType.SYSTEM],
      label: 'Delivery failed',
    },
  ],

  // Terminal states. An order that has been delivered, cancelled, rejected or
  // failed never moves again — corrections are made through refunds, which
  // leave their own audit trail rather than rewriting history.
  [OrderStatus.DELIVERED]: [],
  [OrderStatus.CANCELLED]: [],
  [OrderStatus.REJECTED]: [],
  [OrderStatus.FAILED]: [],
};

/** Statuses after which the kitchen has committed resources to the order. */
const KITCHEN_COMMITTED: OrderStatus[] = [
  OrderStatus.PREPARING,
  OrderStatus.READY_FOR_PICKUP,
  OrderStatus.PICKED_UP,
  OrderStatus.ON_THE_WAY,
];

export const TERMINAL_STATUSES: OrderStatus[] = [
  OrderStatus.DELIVERED,
  OrderStatus.CANCELLED,
  OrderStatus.REJECTED,
  OrderStatus.FAILED,
];

/** Statuses whose money should be returned when the order ends badly. */
export const REFUNDABLE_STATUSES: OrderStatus[] = [
  OrderStatus.CANCELLED,
  OrderStatus.REJECTED,
  OrderStatus.FAILED,
];

export class OrderStateMachine {
  /** Every transition legal from a status, regardless of who may perform it. */
  static allowedFrom(status: OrderStatus): TransitionRule[] {
    return ORDER_TRANSITIONS[status];
  }

  static isTerminal(status: OrderStatus): boolean {
    return TERMINAL_STATUSES.includes(status);
  }

  /**
   * Validates a transition and returns its rule.
   *
   * Both halves matter: the move must be legal *and* the actor must be entitled
   * to make it. A customer cannot mark their own order delivered, and a rider
   * cannot accept one on the restaurant's behalf.
   */
  static assertTransition(from: OrderStatus, to: OrderStatus, actor: ActorType): TransitionRule {
    if (from === to) {
      throw new BusinessRuleViolationException(`This order is already ${from}.`);
    }

    if (this.isTerminal(from)) {
      throw new BusinessRuleViolationException(`This order is ${from} and can no longer change.`);
    }

    const rule = ORDER_TRANSITIONS[from].find((candidate) => candidate.to === to);

    if (!rule) {
      const legal = ORDER_TRANSITIONS[from].map((candidate) => candidate.to);
      throw new BusinessRuleViolationException(
        `An order cannot move from ${from} to ${to}. Allowed: ${legal.join(', ') || 'none'}.`,
      );
    }

    if (!rule.actors.includes(actor)) {
      throw new BusinessRuleViolationException(
        `A ${actor.toLowerCase()} is not permitted to make this change.`,
      );
    }

    return rule;
  }

  /**
   * Whether a customer may still cancel without penalty.
   *
   * Once the kitchen has started cooking, the food is already a cost someone
   * has to bear — so free cancellation stops at PREPARING, and later
   * cancellations become an operator decision rather than a self-service one.
   */
  static customerMayCancel(
    status: OrderStatus,
    placedAt: Date | null,
    windowMinutes: number,
    now: Date = new Date(),
  ): { allowed: boolean; reason?: string } {
    if (this.isTerminal(status)) {
      return { allowed: false, reason: `This order is already ${status.toLowerCase()}.` };
    }

    if (KITCHEN_COMMITTED.includes(status)) {
      return {
        allowed: false,
        reason:
          'The restaurant has already started preparing this order. Contact support if you need to cancel.',
      };
    }

    if (placedAt === null) {
      return { allowed: true };
    }

    const elapsedMinutes = (now.getTime() - placedAt.getTime()) / 60000;

    if (elapsedMinutes > windowMinutes) {
      return {
        allowed: false,
        reason: `Free cancellation is only available for ${windowMinutes} minutes after ordering.`,
      };
    }

    return { allowed: true };
  }

  /** Customer-facing wording for the current status. */
  static describe(status: OrderStatus): string {
    const text: Record<OrderStatus, string> = {
      [OrderStatus.PENDING_PAYMENT]: 'Waiting for payment',
      [OrderStatus.PLACED]: 'Sent to the restaurant',
      [OrderStatus.CONFIRMED]: 'Accepted — preparing shortly',
      [OrderStatus.PREPARING]: 'Being prepared',
      [OrderStatus.READY_FOR_PICKUP]: 'Ready — waiting for a rider',
      [OrderStatus.PICKED_UP]: 'Collected by your rider',
      [OrderStatus.ON_THE_WAY]: 'On the way to you',
      [OrderStatus.DELIVERED]: 'Delivered',
      [OrderStatus.CANCELLED]: 'Cancelled',
      [OrderStatus.REJECTED]: 'Rejected by the restaurant',
      [OrderStatus.FAILED]: 'Delivery failed',
    };

    return text[status];
  }
}
