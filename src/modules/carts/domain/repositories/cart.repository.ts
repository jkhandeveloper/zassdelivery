import type {
  AddOn,
  Address,
  Cart,
  CartItem,
  CartItemAddOn,
  Coupon,
  MenuItem,
  MenuVariant,
  OrderType,
  Restaurant,
  VehicleType,
} from '@prisma/client';

/** A cart loaded with everything pricing and validation need, in one read. */
export type CartWithContents = Cart & {
  restaurant: Pick<
    Restaurant,
    | 'id'
    | 'name'
    | 'slug'
    | 'logoUrl'
    | 'status'
    | 'isAcceptingOrders'
    | 'minOrderAmount'
    | 'avgPreparationMinutes'
    | 'zoneId'
    | 'latitude'
    | 'longitude'
    | 'deliveryRadiusMeters'
    | 'paymentQrCodes'
  >;
  address: Address | null;
  coupon: Coupon | null;
  items: Array<
    CartItem & {
      menuItem: MenuItem;
      variant: MenuVariant | null;
      addOns: Array<CartItemAddOn & { addOn: AddOn }>;
    }
  >;
};

export interface AddItemInput {
  menuItemId: string;
  variantId?: string | null;
  quantity: number;
  notes?: string | null;
  addOns: Array<{ addOnId: string; quantity: number }>;
}

export abstract class CartRepository {
  abstract findByUserId(userId: string): Promise<CartWithContents | null>;
  abstract findById(cartId: string): Promise<CartWithContents | null>;

  /**
   * Returns the user's cart, creating one for this restaurant if none exists.
   * When a cart exists for a *different* restaurant, it is replaced — a single
   * order cannot span two kitchens.
   */
  abstract findOrCreate(
    userId: string,
    restaurantId: string,
    ttlHours: number,
  ): Promise<{ cart: CartWithContents; replacedRestaurant: string | null }>;

  abstract addItem(cartId: string, input: AddItemInput): Promise<CartWithContents>;
  /** Bumps an existing line's quantity instead of adding a duplicate. */
  abstract incrementItem(cartItemId: string, by: number): Promise<void>;
  abstract findItem(cartItemId: string): Promise<(CartItem & { cartId: string }) | null>;
  abstract updateItemQuantity(cartItemId: string, quantity: number): Promise<CartWithContents>;
  abstract removeItem(cartItemId: string): Promise<CartWithContents>;
  abstract clear(userId: string): Promise<void>;

  abstract setCoupon(cartId: string, couponId: string | null, code: string | null): Promise<void>;
  abstract setAddress(cartId: string, addressId: string | null): Promise<void>;
  abstract setTip(cartId: string, tipAmount: number): Promise<void>;
  abstract setFulfilment(cartId: string, fulfilment: OrderType): Promise<void>;
  abstract setPreferredDriver(cartId: string, driverId: string | null): Promise<void>;
  abstract touchExpiry(cartId: string, ttlHours: number): Promise<void>;

  /** Housekeeping: removes baskets abandoned past their expiry. */
  abstract deleteExpired(before: Date): Promise<number>;
}

/** Coupon lookup and eligibility data, kept out of the cart aggregate. */
export abstract class CartCouponRepository {
  abstract findActiveByCode(code: string): Promise<Coupon | null>;
  abstract countRedemptionsByUser(couponId: string, userId: string): Promise<number>;
  abstract hasPlacedOrder(userId: string): Promise<boolean>;
}

export interface DeliveryQuote {
  fee: number;
  freeDeliveryThreshold: number | null;
  distanceKm: number;
  etaMinutes: number;
  zoneId: string;
}

/** A rider a customer may choose, free to take a run right now. */
export interface AvailableRider {
  driverId: string;
  fullName: string;
  avatarUrl: string | null;
  rating: number;
  ratingCount: number;
  totalDeliveries: number;
  vehicleType: VehicleType | null;
  /** The rider's own rate, or null when they charge the platform's. */
  perKmRate: number | null;
  /** Straight-line distance from the rider to the business. */
  distanceToPickupKm: number;
}

export interface AvailableRiderSearch {
  pickupLat: number;
  pickupLng: number;
  radiusKm: number;
  /** Positions reported before this are too old to trust. */
  freshSince: Date;
  /** Narrows the search to one rider: is this one still free? */
  driverId?: string;
}

/** Resolves what delivery costs for a given basket destination. */
export abstract class DeliveryPricingRepository {
  /**
   * Per-kilometre fee for delivering from a restaurant to an address.
   * Returns null when the address lies outside the deliverable area — beyond
   * the restaurant's own radius, or the platform's maximum delivery distance.
   *
   * `riderRate` prices the run at a chosen rider's own rate instead of the
   * platform's, without the platform's maximum fee.
   */
  abstract quote(
    restaurantLat: number,
    restaurantLng: number,
    restaurantRadiusMeters: number,
    addressLat: number,
    addressLng: number,
    zoneId: string,
    riderRate?: number | null,
  ): Promise<DeliveryQuote | null>;

  /**
   * Riders who could take a run from this business now — approved, online,
   * carrying nothing, and recently located within the radius — nearest first.
   */
  abstract findAvailableRiders(search: AvailableRiderSearch): Promise<AvailableRider[]>;

  /** Reads a numeric platform setting, falling back when it is absent. */
  abstract numericSetting(key: string, fallback: number): Promise<number>;
}
