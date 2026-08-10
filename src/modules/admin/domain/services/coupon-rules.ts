import { CouponType } from '@prisma/client';

import { BusinessRuleViolationException } from '@/common/exceptions/domain.exception';

export interface CouponShape {
  type: CouponType;
  value: number;
  maxDiscountAmount?: number | null;
  minOrderAmount?: number | null;
  startsAt: Date;
  expiresAt: Date;
  usageLimit?: number | null;
  perUserLimit?: number | null;
}

/**
 * What makes a coupon coherent.
 *
 * Every rule here exists because the alternative is a coupon that behaves in a
 * way nobody intended and that customers find before finance does. A discount
 * is the one thing on this platform an operator can create that spends money
 * directly, so the shape is checked before it is saved rather than discovered
 * at redemption.
 */
export class CouponRules {
  static assertValid(coupon: CouponShape): void {
    this.assertWindow(coupon);
    this.assertValue(coupon);
    this.assertLimits(coupon);
  }

  private static assertWindow(coupon: CouponShape): void {
    if (coupon.expiresAt <= coupon.startsAt) {
      throw new BusinessRuleViolationException('A coupon must expire after it starts.');
    }
  }

  private static assertValue(coupon: CouponShape): void {
    if (coupon.type === CouponType.PERCENTAGE) {
      if (coupon.value <= 0 || coupon.value > 100) {
        throw new BusinessRuleViolationException('A percentage coupon must be between 1 and 100.');
      }

      // Without a ceiling, "50% off" on a large order is an open-ended
      // liability — and the largest orders are exactly the ones that find it.
      if (
        coupon.maxDiscountAmount === null ||
        coupon.maxDiscountAmount === undefined ||
        coupon.maxDiscountAmount <= 0
      ) {
        throw new BusinessRuleViolationException(
          'A percentage coupon needs maxDiscountAmount, or a large order could discount without limit.',
        );
      }

      return;
    }

    if (coupon.type === CouponType.FIXED_AMOUNT) {
      if (coupon.value <= 0) {
        throw new BusinessRuleViolationException('A fixed-amount coupon must be worth something.');
      }

      // A discount larger than the floor it applies to means the platform pays
      // the customer to order.
      if (
        coupon.minOrderAmount !== null &&
        coupon.minOrderAmount !== undefined &&
        coupon.value > coupon.minOrderAmount
      ) {
        throw new BusinessRuleViolationException(
          `A Rs. ${coupon.value} discount on a Rs. ${coupon.minOrderAmount} minimum would exceed the order value. Raise the minimum.`,
        );
      }
    }
  }

  private static assertLimits(coupon: CouponShape): void {
    if (coupon.usageLimit !== null && coupon.usageLimit !== undefined && coupon.usageLimit < 1) {
      throw new BusinessRuleViolationException(
        'A usage limit of zero would make the coupon unusable. Leave it empty for unlimited.',
      );
    }

    if (
      coupon.perUserLimit !== null &&
      coupon.perUserLimit !== undefined &&
      coupon.perUserLimit < 1
    ) {
      throw new BusinessRuleViolationException(
        'A per-user limit of zero would make the coupon unusable. Leave it empty for unlimited.',
      );
    }

    if (
      coupon.usageLimit !== null &&
      coupon.usageLimit !== undefined &&
      coupon.perUserLimit !== null &&
      coupon.perUserLimit !== undefined &&
      coupon.perUserLimit > coupon.usageLimit
    ) {
      throw new BusinessRuleViolationException(
        'The per-user limit cannot exceed the total usage limit.',
      );
    }
  }

  /** Whether a coupon is redeemable right now, for the customer-facing list. */
  static isLive(
    coupon: {
      isActive: boolean;
      startsAt: Date;
      expiresAt: Date;
      usageLimit: number | null;
      usageCount: number;
    },
    now: Date = new Date(),
  ): boolean {
    if (!coupon.isActive || coupon.startsAt > now || coupon.expiresAt <= now) {
      return false;
    }

    return coupon.usageLimit === null || coupon.usageCount < coupon.usageLimit;
  }
}
