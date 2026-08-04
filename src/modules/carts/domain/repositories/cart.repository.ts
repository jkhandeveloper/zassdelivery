import type {
  AddOn,
  Address,
  Cart,
  CartItem,
  CartItemAddOn,
  Coupon,
  MenuItem,
  MenuVariant,
  Restaurant,
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

/** Resolves what delivery costs for a given basket destination. */
export abstract class DeliveryPricingRepository {
  /**
   * Distance-banded fee for delivering from a restaurant to an address.
   * Returns null when the address lies outside the deliverable area.
   */
  abstract quote(
    restaurantLat: number,
    restaurantLng: number,
    restaurantRadiusMeters: number,
    addressLat: number,
    addressLng: number,
    zoneId: string,
  ): Promise<DeliveryQuote | null>;

  /** Reads a numeric platform setting, falling back when it is absent. */
  abstract numericSetting(key: string, fallback: number): Promise<number>;
}
