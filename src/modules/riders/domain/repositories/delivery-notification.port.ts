/**
 * How a delivery code reaches the customer.
 *
 * Declared as a port because the channel is going to change: today the code
 * lands as an in-app notification, and when the notifications module ships it
 * will also go out over SMS and push. Nothing in the delivery flow should have
 * to change when that happens.
 */
export abstract class DeliveryNotificationPort {
  /**
   * Tells the customer their rider is on the way, and what code to give them.
   *
   * This is the only place the plaintext code exists after it is generated —
   * the assignment stores nothing but a hash.
   */
  abstract sendDeliveryCode(input: {
    customerId: string;
    orderId: string;
    orderNumber: string;
    code: string;
    riderName: string;
  }): Promise<void>;

  /** Tells the customer who is bringing their order, once a rider accepts. */
  abstract sendRiderAssigned(input: {
    customerId: string;
    orderId: string;
    orderNumber: string;
    riderName: string;
    riderPhone: string;
  }): Promise<void>;

  /**
   * Tells a rider a run is waiting for them.
   *
   * The socket push already reaches a rider with the app open; this is for the
   * one whose phone is in their pocket. An offer has a sixty-second window, so
   * it is the clearest case in the product for waking a device rather than
   * waiting to be looked at.
   */
  abstract sendOfferToRider(input: {
    riderUserId: string;
    assignmentId: string;
    orderId: string;
    orderNumber: string;
    restaurantName: string;
    estimatedEarning: number;
    expiresAt: Date;
  }): Promise<void>;
}
