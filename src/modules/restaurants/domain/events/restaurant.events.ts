/**
 * What the restaurants module announces, as data.
 *
 * Billing starts a vendor's free month the day their listing goes live, and it
 * learns about that from here rather than from a call: `BillingModule` imports
 * `RestaurantsModule` for the repository it reads listings through, so a direct
 * call back the other way would be a cycle.
 *
 * Listeners are strictly downstream. Approval has already committed by the time
 * one runs, and nothing a listener does can fail it — a vendor must never be
 * left unapproved because billing was having a bad day.
 */
export const RestaurantEvents = {
  /** An administrator approved a listing, and it is now live. */
  approved: 'restaurant.approved',
} as const;

export interface RestaurantApprovedPayload {
  restaurantId: string;
  restaurantName: string;
  /** The vendor's user id — who the subscription and its invoices belong to. */
  ownerId: string;
  /** When it went live, which is when the free first month starts counting. */
  approvedAt: string;
}
