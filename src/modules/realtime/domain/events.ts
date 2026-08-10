import type { ActorType, OrderStatus } from '@prisma/client';

/**
 * The wire protocol, declared as data.
 *
 * Event names live here rather than as string literals at each emit site,
 * because a mistyped event name is the quietest bug in a socket system: nothing
 * throws, nothing logs, and a client simply never hears about the thing that
 * happened.
 */
export const ServerEvents = {
  /** Sent once, immediately after a successful handshake. */
  ready: 'connection:ready',

  /** The full current state of an order, sent on subscribe and on reconnect. */
  orderSnapshot: 'order:snapshot',
  /** One lifecycle transition. */
  orderStatus: 'order:status',

  /** A rider's position, while they are carrying an order. */
  riderLocation: 'rider:location',
  /** A rider has taken the delivery; the customer learns who is coming. */
  riderAssigned: 'rider:assigned',
  /** A delivery has been offered to this rider. */
  deliveryOffered: 'delivery:offered',

  /** A new ticket for the kitchen. */
  restaurantOrder: 'restaurant:order',
  /** An existing ticket changed — cancelled, paid, collected. */
  restaurantOrderUpdated: 'restaurant:order-updated',

  /** An in-app notification, delivered live rather than on next poll. */
  notification: 'notification:new',

  /** A subscription request that could not be honoured, and why. */
  subscriptionError: 'subscription:error',
} as const;

export const ClientEvents = {
  orderSubscribe: 'order:subscribe',
  orderUnsubscribe: 'order:unsubscribe',
  restaurantSubscribe: 'restaurant:subscribe',
  restaurantUnsubscribe: 'restaurant:unsubscribe',
  riderLocation: 'rider:location',
  /** Round-trip probe, so a client can measure its own latency. */
  ping: 'ping',
} as const;

// ── Payloads ───────────────────────────────────────────────────

export interface ReadyPayload {
  userId: string;
  role: string;
  /** Rooms joined automatically, before the client asks for anything. */
  rooms: string[];
  /** True when Socket.IO restored a dropped session rather than opening a new one. */
  recovered: boolean;
  serverTime: string;
}

export interface OrderStatusPayload {
  orderId: string;
  orderNumber: string;
  status: OrderStatus;
  statusText: string;
  actor: ActorType | null;
  at: string;
}

export interface OrderSnapshotPayload extends OrderStatusPayload {
  restaurantName: string;
  estimatedDeliveryAt: string | null;
  rider: { id: string; name: string; phone: string } | null;
  /** The rider's last known position, so a reconnecting map is not blank. */
  riderLocation: RiderLocationPayload | null;
}

export interface RiderLocationPayload {
  orderId: string | null;
  driverId: string;
  latitude: number;
  longitude: number;
  /** Straight-line distance left to the drop-off, when the order is known. */
  distanceKm: number | null;
  at: string;
}

export interface RiderAssignedPayload {
  orderId: string;
  driverId: string;
  riderName: string;
  riderPhone: string;
  at: string;
}

export interface DeliveryOfferedPayload {
  assignmentId: string;
  orderId: string;
  orderNumber: string;
  restaurantName: string;
  estimatedEarning: number;
  pickupDistanceKm: number | null;
  expiresAt: string;
}

export interface RestaurantOrderPayload {
  orderId: string;
  orderNumber: string;
  status: OrderStatus;
  totalAmount: number;
  itemCount: number;
  customerName: string;
  placedAt: string | null;
}

export interface NotificationPayload {
  id: string;
  type: string;
  title: string;
  body: string;
  data: unknown;
  createdAt: string;
}

export interface SubscriptionErrorPayload {
  room: string;
  reason: string;
}

/** Acknowledgement returned to a client that asked to subscribe. */
export interface SubscriptionAck {
  ok: boolean;
  room: string | null;
  error: string | null;
  /**
   * The current state, for a subscribe that asked for one.
   *
   * Carried in the acknowledgement *and* emitted as `order:snapshot`, because
   * the two client styles race otherwise: a client that passes a callback has
   * not attached its event listener by the time the handler emits, and would
   * miss the very snapshot it subscribed for.
   */
  snapshot?: OrderSnapshotPayload;
}
