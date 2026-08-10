import { Inject, Injectable, type LoggerService } from '@nestjs/common';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import type { Server } from 'socket.io';

import { ServerEvents } from '../domain/events';
import type {
  DeliveryOfferedPayload,
  NotificationPayload,
  OrderStatusPayload,
  RestaurantOrderPayload,
  RiderAssignedPayload,
  RiderLocationPayload,
} from '../domain/events';
import { Rooms } from '../domain/rooms';

/**
 * How the rest of the platform pushes something live.
 *
 * Every other module depends on this rather than on Socket.IO, which keeps the
 * dependency arrows pointing one way: modules publish into realtime, realtime
 * imports none of them. It also means a module can be tested without a socket
 * server, and that swapping the transport is a change confined to this file and
 * the gateway.
 *
 * **Every method here is fire-and-forget.** A websocket is a convenience on top
 * of state that has already been committed: an order is placed whether or not
 * the customer's phone was listening. Letting a socket failure propagate would
 * roll back a delivery because somebody's wifi dropped.
 */
@Injectable()
export class RealtimeService {
  private readonly context = RealtimeService.name;

  /**
   * Set by the gateway once Socket.IO is listening.
   *
   * Null until then, and null forever in a deployment that never starts the
   * gateway — which is why every emit checks. A publish before the server is up
   * is a no-op, not a crash during boot.
   */
  private server: Server | null = null;

  constructor(
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: LoggerService,
  ) {}

  /** Called by the gateway in `afterInit`. */
  bind(server: Server): void {
    this.server = server;
  }

  get isLive(): boolean {
    return this.server !== null;
  }

  // ── Orders ─────────────────────────────────────────────────

  /** A lifecycle transition, to everyone watching that order. */
  orderStatusChanged(payload: OrderStatusPayload): void {
    this.emit(Rooms.order(payload.orderId), ServerEvents.orderStatus, payload);
  }

  /** A new ticket for a kitchen dashboard. */
  restaurantOrderPlaced(restaurantId: string, payload: RestaurantOrderPayload): void {
    this.emit(Rooms.restaurant(restaurantId), ServerEvents.restaurantOrder, payload);
  }

  restaurantOrderUpdated(restaurantId: string, payload: RestaurantOrderPayload): void {
    this.emit(Rooms.restaurant(restaurantId), ServerEvents.restaurantOrderUpdated, payload);
  }

  // ── Riders ─────────────────────────────────────────────────

  /**
   * A rider's position.
   *
   * Goes to the order's room — where the customer is watching — and to the
   * dispatch board, which follows every rider at once.
   */
  riderMoved(payload: RiderLocationPayload): void {
    if (payload.orderId !== null) {
      this.emit(Rooms.order(payload.orderId), ServerEvents.riderLocation, payload);
    }

    this.emit(Rooms.dispatch(), ServerEvents.riderLocation, payload);
  }

  riderAssigned(payload: RiderAssignedPayload): void {
    this.emit(Rooms.order(payload.orderId), ServerEvents.riderAssigned, payload);
    this.emit(Rooms.dispatch(), ServerEvents.riderAssigned, payload);
  }

  /**
   * A delivery offer, to that rider alone.
   *
   * This is what makes an offer worth having a sixty-second window: a rider who
   * has to poll for work finds out about it forty seconds late.
   */
  deliveryOffered(driverId: string, payload: DeliveryOfferedPayload): void {
    this.emit(Rooms.rider(driverId), ServerEvents.deliveryOffered, payload);
    this.emit(Rooms.dispatch(), ServerEvents.deliveryOffered, payload);
  }

  // ── Notifications ──────────────────────────────────────────

  /** An in-app notification, delivered now rather than on the next poll. */
  notificationCreated(userId: string, payload: NotificationPayload): void {
    this.emit(Rooms.user(userId), ServerEvents.notification, payload);
  }

  // ── Plumbing ───────────────────────────────────────────────

  /** Connected sockets, for the presence endpoint and health checks. */
  async connectionCount(): Promise<number> {
    if (this.server === null) {
      return 0;
    }

    // Counts across every instance when the Redis adapter is in play, which is
    // the only number worth reporting behind a load balancer.
    const sockets = await this.server.fetchSockets();

    return sockets.length;
  }

  async roomSize(room: string): Promise<number> {
    if (this.server === null) {
      return 0;
    }

    const sockets = await this.server.in(room).fetchSockets();

    return sockets.length;
  }

  private emit(room: string, event: string, payload: unknown): void {
    if (this.server === null) {
      return;
    }

    try {
      this.server.to(room).emit(event, payload);
    } catch (error) {
      // Swallowed on purpose. The caller has already committed the thing this
      // announces; failing their transaction because a broadcast did not go out
      // would trade a missed update for a lost order.
      this.logger.warn?.(
        `Could not emit ${event} to ${room}: ${(error as Error).message}`,
        this.context,
      );
    }
  }
}
