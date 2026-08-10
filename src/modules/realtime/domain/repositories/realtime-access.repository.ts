import type { OrderStatus } from '@prisma/client';

/** The order state a reconnecting client needs to redraw its screen. */
export interface OrderSnapshot {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  customerId: string;
  restaurantId: string;
  restaurantName: string;
  driverId: string | null;
  estimatedDeliveryAt: Date | null;
  deliveryLat: number | null;
  deliveryLng: number | null;
  rider: { id: string; name: string; phone: string } | null;
  riderLocation: { latitude: number; longitude: number; at: Date } | null;
  updatedAt: Date;
}

/**
 * The lookups a socket connection needs, and nothing else.
 *
 * Deliberately its own narrow port rather than a dependency on the orders and
 * riders modules. Those modules publish *into* realtime; if realtime also
 * imported them the graph would be circular, and the circularity would be
 * carrying nothing but four questions that are a single query each.
 */
export abstract class RealtimeAccessRepository {
  /**
   * Whether this user may watch this order.
   *
   * The customer who placed it, the rider carrying it, the kitchen cooking it —
   * and nobody else. This is the check that stops a socket becoming a way to
   * read strangers' addresses.
   */
  abstract canAccessOrder(userId: string, isStaff: boolean, orderId: string): Promise<boolean>;

  /** Whether this user works at, or owns, this restaurant. */
  abstract canAccessRestaurant(
    userId: string,
    isStaff: boolean,
    restaurantId: string,
  ): Promise<boolean>;

  /** The rider profile behind a user account, if there is one. */
  abstract driverIdForUser(userId: string): Promise<string | null>;

  /** The order a rider is currently carrying, for validating position reports. */
  abstract activeOrderForDriver(driverId: string): Promise<string | null>;

  abstract orderSnapshot(orderId: string): Promise<OrderSnapshot | null>;

  /** Records a position report. Called at most once per throttle window. */
  abstract saveDriverLocation(driverId: string, latitude: number, longitude: number): Promise<void>;
}
