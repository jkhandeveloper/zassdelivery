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
}
