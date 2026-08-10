import { CouponType } from '@prisma/client';

import { BusinessRuleViolationException } from '@/common/exceptions/domain.exception';

import { CouponRules, type CouponShape } from './coupon-rules';

const STARTS = new Date('2026-08-10T00:00:00.000Z');
const EXPIRES = new Date('2026-09-10T00:00:00.000Z');

function percentage(overrides: Partial<CouponShape> = {}): CouponShape {
  return {
    type: CouponType.PERCENTAGE,
    value: 20,
    maxDiscountAmount: 200,
    minOrderAmount: 500,
    startsAt: STARTS,
    expiresAt: EXPIRES,
    ...overrides,
  };
}

function fixed(overrides: Partial<CouponShape> = {}): CouponShape {
  return {
    type: CouponType.FIXED_AMOUNT,
    value: 100,
    minOrderAmount: 500,
    startsAt: STARTS,
    expiresAt: EXPIRES,
    ...overrides,
  };
}

describe('CouponRules — the window', () => {
  it('accepts a coupon that expires after it starts', () => {
    expect(() => CouponRules.assertValid(percentage())).not.toThrow();
  });

  it('refuses a coupon that expires before it starts', () => {
    expect(() =>
      CouponRules.assertValid(percentage({ expiresAt: new Date('2026-08-01T00:00:00.000Z') })),
    ).toThrow(/must expire after it starts/);
  });

  it('refuses a zero-length window', () => {
    expect(() => CouponRules.assertValid(percentage({ expiresAt: STARTS }))).toThrow(
      BusinessRuleViolationException,
    );
  });
});

describe('CouponRules — percentage coupons', () => {
  it('accepts a sensible percentage with a ceiling', () => {
    expect(() => CouponRules.assertValid(percentage())).not.toThrow();
  });

  it('refuses a percentage over 100', () => {
    expect(() => CouponRules.assertValid(percentage({ value: 120 }))).toThrow(/between 1 and 100/);
  });

  it('refuses a percentage of zero', () => {
    expect(() => CouponRules.assertValid(percentage({ value: 0 }))).toThrow(/between 1 and 100/);
  });

  it('refuses a percentage with no ceiling — a large order would discount without limit', () => {
    expect(() => CouponRules.assertValid(percentage({ maxDiscountAmount: null }))).toThrow(
      /needs maxDiscountAmount/,
    );
  });

  it('refuses a ceiling of zero, which is the same as having none', () => {
    expect(() => CouponRules.assertValid(percentage({ maxDiscountAmount: 0 }))).toThrow(
      /needs maxDiscountAmount/,
    );
  });

  it('accepts exactly 100%', () => {
    expect(() => CouponRules.assertValid(percentage({ value: 100 }))).not.toThrow();
  });
});

describe('CouponRules — fixed-amount coupons', () => {
  it('accepts a discount smaller than the minimum order', () => {
    expect(() => CouponRules.assertValid(fixed())).not.toThrow();
  });

  it('refuses a discount worth nothing', () => {
    expect(() => CouponRules.assertValid(fixed({ value: 0 }))).toThrow(/must be worth something/);
  });

  it('refuses a discount larger than the order it applies to', () => {
    // Otherwise the platform pays the customer to order.
    expect(() => CouponRules.assertValid(fixed({ value: 600, minOrderAmount: 500 }))).toThrow(
      /would exceed the order value/,
    );
  });

  it('does not require a ceiling, which is meaningless on a fixed amount', () => {
    expect(() => CouponRules.assertValid(fixed({ maxDiscountAmount: null }))).not.toThrow();
  });
});

describe('CouponRules — limits', () => {
  it('accepts sensible limits', () => {
    expect(() =>
      CouponRules.assertValid(percentage({ usageLimit: 1000, perUserLimit: 1 })),
    ).not.toThrow();
  });

  it('treats no limit as unlimited rather than as zero', () => {
    expect(() =>
      CouponRules.assertValid(percentage({ usageLimit: null, perUserLimit: null })),
    ).not.toThrow();
  });

  it('refuses a usage limit of zero, which would make the coupon unusable', () => {
    expect(() => CouponRules.assertValid(percentage({ usageLimit: 0 }))).toThrow(
      /Leave it empty for unlimited/,
    );
  });

  it('refuses a per-user limit larger than the total', () => {
    expect(() => CouponRules.assertValid(percentage({ usageLimit: 10, perUserLimit: 50 }))).toThrow(
      /cannot exceed the total usage limit/,
    );
  });
});

describe('CouponRules.isLive', () => {
  const now = new Date('2026-08-20T00:00:00.000Z');

  const base = {
    isActive: true,
    startsAt: STARTS,
    expiresAt: EXPIRES,
    usageLimit: 100,
    usageCount: 10,
  };

  it('is live when active, in window and not exhausted', () => {
    expect(CouponRules.isLive(base, now)).toBe(true);
  });

  it('is not live when deactivated', () => {
    expect(CouponRules.isLive({ ...base, isActive: false }, now)).toBe(false);
  });

  it('is not live before it starts', () => {
    expect(CouponRules.isLive(base, new Date('2026-08-01T00:00:00.000Z'))).toBe(false);
  });

  it('is not live after it expires', () => {
    expect(CouponRules.isLive(base, new Date('2026-10-01T00:00:00.000Z'))).toBe(false);
  });

  it('is not live once it is exhausted', () => {
    // Active, in window, and still unusable — which is why this is computed
    // rather than read off the isActive flag.
    expect(CouponRules.isLive({ ...base, usageCount: 100 }, now)).toBe(false);
  });

  it('is live with no usage limit however many redemptions there have been', () => {
    expect(CouponRules.isLive({ ...base, usageLimit: null, usageCount: 99999 }, now)).toBe(true);
  });
});
