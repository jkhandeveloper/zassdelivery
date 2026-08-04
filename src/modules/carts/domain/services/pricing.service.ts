import { CouponType } from '@prisma/client';

/** One priced basket line. */
export interface PricedLine {
  cartItemId: string;
  menuItemId: string;
  name: string;
  variantName: string | null;
  /** Unit price before add-ons: the variant price when chosen, else the dish price. */
  unitPrice: number;
  addOnsTotal: number;
  quantity: number;
  /** (unitPrice + addOnsTotal) × quantity. */
  lineTotal: number;
}

export interface CouponContext {
  type: CouponType;
  value: number;
  maxDiscountAmount: number | null;
  minOrderAmount: number;
}

export interface PricingInput {
  lines: PricedLine[];
  coupon: CouponContext | null;
  /** Zone or distance-band fee before any waiver. */
  baseDeliveryFee: number;
  /** Subtotal at or above which delivery is free. Null disables it. */
  freeDeliveryThreshold: number | null;
  serviceFeePercentage: number;
  taxPercentage: number;
  tipAmount: number;
}

export interface PricingBreakdown {
  subtotal: number;
  discountAmount: number;
  deliveryFee: number;
  serviceFee: number;
  taxAmount: number;
  tipAmount: number;
  totalAmount: number;
  /** Why delivery was free, when it was. */
  freeDeliveryReason: 'threshold' | 'coupon' | null;
  itemCount: number;
  totalQuantity: number;
}

/**
 * Rounds to two decimal places for PKR.
 *
 * Every intermediate figure passes through here rather than only the total,
 * so the parts always add up to the sum. Rounding once at the end lets a few
 * fractional paisa drift and produces a receipt whose lines do not reconcile —
 * which is also what the `orders_total_is_consistent` CHECK constraint would
 * reject at insert time.
 */
export function money(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * The single place order totals are computed.
 *
 * Deliberately a pure function of its input: no database, no clock, no
 * request context. Checkout and the cart preview must agree to the paisa, and
 * the only way to guarantee that is for both to run this exact code.
 *
 * The formula matches the `orders_total_is_consistent` database constraint:
 *
 *   total = subtotal − discount + delivery + service + tax + tip
 */
export class PricingService {
  calculate(input: PricingInput): PricingBreakdown {
    const subtotal = money(input.lines.reduce((sum, line) => sum + line.lineTotal, 0));

    const coupon = input.coupon;
    const couponApplies = coupon !== null && subtotal >= coupon.minOrderAmount;

    // A free-delivery coupon waives the fee; it is not a discount on the food,
    // so it must not reduce the subtotal.
    const couponWaivesDelivery = couponApplies && coupon.type === CouponType.FREE_DELIVERY;

    const meetsThreshold =
      input.freeDeliveryThreshold !== null && subtotal >= input.freeDeliveryThreshold;

    const freeDeliveryReason: PricingBreakdown['freeDeliveryReason'] = meetsThreshold
      ? 'threshold'
      : couponWaivesDelivery
        ? 'coupon'
        : null;

    const deliveryFee = freeDeliveryReason === null ? money(input.baseDeliveryFee) : 0;

    const discountAmount = couponApplies
      ? this.discountFor(coupon, subtotal, input.baseDeliveryFee, freeDeliveryReason)
      : 0;

    // Fees are charged on the discounted basket, not the list price: billing a
    // service fee on money the customer never paid is indefensible on a receipt.
    const discountedSubtotal = money(Math.max(0, subtotal - discountAmount));

    const serviceFee = money((discountedSubtotal * input.serviceFeePercentage) / 100);
    const taxAmount = money(((discountedSubtotal + serviceFee) * input.taxPercentage) / 100);
    const tipAmount = money(input.tipAmount);

    const totalAmount = money(
      subtotal - discountAmount + deliveryFee + serviceFee + taxAmount + tipAmount,
    );

    return {
      subtotal,
      discountAmount,
      deliveryFee,
      serviceFee,
      taxAmount,
      tipAmount,
      totalAmount,
      freeDeliveryReason,
      itemCount: input.lines.length,
      totalQuantity: input.lines.reduce((sum, line) => sum + line.quantity, 0),
    };
  }

  private discountFor(
    coupon: CouponContext,
    subtotal: number,
    baseDeliveryFee: number,
    freeDeliveryReason: PricingBreakdown['freeDeliveryReason'],
  ): number {
    switch (coupon.type) {
      case CouponType.PERCENTAGE: {
        const raw = (subtotal * coupon.value) / 100;
        // The cap is what stops "50% off" from costing more than intended on a
        // large basket.
        return money(
          coupon.maxDiscountAmount === null ? raw : Math.min(raw, coupon.maxDiscountAmount),
        );
      }

      case CouponType.FIXED_AMOUNT:
        // Never discount below zero: a Rs.100 coupon on a Rs.80 basket takes
        // 80, not 100, or the total would go negative.
        return money(Math.min(coupon.value, subtotal));

      case CouponType.FREE_DELIVERY:
        // Reported as a discount only when the coupon is what actually waived
        // the fee. If the basket already qualified on its own threshold the
        // coupon saved nothing, and claiming otherwise would inflate the
        // "you saved" figure on the receipt.
        return freeDeliveryReason === 'coupon' ? money(baseDeliveryFee) : 0;

      default:
        return 0;
    }
  }
}
