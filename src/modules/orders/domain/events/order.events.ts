import type { ActorType, OrderStatus } from '@prisma/client';

/**
 * What the orders module announces, as data.
 *
 * These exist so that dispatch and notifications can react to an order without
 * the orders module having to import either. `RidersModule` already imports
 * `OrdersModule` for the shared state machine, so a direct call back the other
 * way would be a cycle — and a `forwardRef` between two modules this central is
 * the kind of wiring that boots fine and fails obscurely a year later.
 *
 * Listeners are strictly downstream: every one of these is emitted *after* the
 * transaction has committed, and nothing a listener does can fail the order.
 */
export const OrderEvents = {
  /** A customer turned their cart into an order. */
  placed: 'order.placed',
  /** An order moved through the state machine — including to a terminal state. */
  statusChanged: 'order.status-changed',
} as const;

/** The shape both events carry; `previousStatus` is null for a placement. */
export interface OrderStatusEventPayload {
  orderId: string;
  orderNumber: string;
  status: OrderStatus;
  /** Human wording for the status, already resolved by the state machine. */
  statusText: string;
  previousStatus: OrderStatus | null;
  /** Who moved it. Null when the order was just placed. */
  actor: ActorType | null;
  customerId: string;
  restaurantId: string;
  restaurantName: string;
  /** The vendor's user id, so the kitchen can be told without a second lookup. */
  restaurantOwnerId: string;
  /** Set once a rider has accepted, so a listener can reach them too. */
  driverUserId: string | null;
  totalAmount: number;
  at: string;
}
