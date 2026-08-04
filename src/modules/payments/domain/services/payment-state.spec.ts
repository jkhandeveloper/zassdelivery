import { PaymentMethod, PaymentStatus } from '@prisma/client';

import { BusinessRuleViolationException } from '@/common/exceptions/domain.exception';

import { PaymentStateMachine } from './payment-state';

describe('PaymentStateMachine.assertTransition', () => {
  it('lets a pending payment be paid', () => {
    expect(() =>
      PaymentStateMachine.assertTransition(PaymentStatus.PENDING, PaymentStatus.PAID),
    ).not.toThrow();
  });

  it('lets a pending payment be authorised before capture', () => {
    expect(() =>
      PaymentStateMachine.assertTransition(PaymentStatus.PENDING, PaymentStatus.AUTHORIZED),
    ).not.toThrow();
  });

  it('lets an authorised payment be captured', () => {
    expect(() =>
      PaymentStateMachine.assertTransition(PaymentStatus.AUTHORIZED, PaymentStatus.PAID),
    ).not.toThrow();
  });

  it('refuses to revive a failed attempt', () => {
    expect(() =>
      PaymentStateMachine.assertTransition(PaymentStatus.FAILED, PaymentStatus.PAID),
    ).toThrow(/cannot move from FAILED to PAID/);
  });

  it('refuses to turn a refund back into a payment', () => {
    expect(() =>
      PaymentStateMachine.assertTransition(PaymentStatus.REFUNDED, PaymentStatus.PAID),
    ).toThrow(BusinessRuleViolationException);
  });

  it('refuses a move to the status already held', () => {
    expect(() =>
      PaymentStateMachine.assertTransition(PaymentStatus.PAID, PaymentStatus.PAID),
    ).toThrow(/already paid/);
  });

  it('lets a partial refund be topped up to a full one', () => {
    expect(() =>
      PaymentStateMachine.assertTransition(
        PaymentStatus.PARTIALLY_REFUNDED,
        PaymentStatus.REFUNDED,
      ),
    ).not.toThrow();
  });

  it('names the legal alternatives when refusing', () => {
    expect(() =>
      PaymentStateMachine.assertTransition(PaymentStatus.PAID, PaymentStatus.PENDING),
    ).toThrow(/Allowed: PARTIALLY_REFUNDED, REFUNDED/);
  });
});

describe('PaymentStateMachine classification', () => {
  it('treats every refund state as settled, because the money did arrive', () => {
    expect(PaymentStateMachine.isSettled(PaymentStatus.PAID)).toBe(true);
    expect(PaymentStateMachine.isSettled(PaymentStatus.PARTIALLY_REFUNDED)).toBe(true);
    expect(PaymentStateMachine.isSettled(PaymentStatus.REFUNDED)).toBe(true);
  });

  it('does not treat a pending or failed attempt as settled', () => {
    expect(PaymentStateMachine.isSettled(PaymentStatus.PENDING)).toBe(false);
    expect(PaymentStateMachine.isSettled(PaymentStatus.AUTHORIZED)).toBe(false);
    expect(PaymentStateMachine.isSettled(PaymentStatus.FAILED)).toBe(false);
  });

  it('knows which attempts are still open', () => {
    expect(PaymentStateMachine.isOpen(PaymentStatus.PENDING)).toBe(true);
    expect(PaymentStateMachine.isOpen(PaymentStatus.AUTHORIZED)).toBe(true);
    expect(PaymentStateMachine.isOpen(PaymentStatus.PAID)).toBe(false);
  });

  it('knows which methods leave the platform', () => {
    expect(PaymentStateMachine.isOnline(PaymentMethod.JAZZCASH)).toBe(true);
    expect(PaymentStateMachine.isOnline(PaymentMethod.EASYPAISA)).toBe(true);
    expect(PaymentStateMachine.isOnline(PaymentMethod.CASH_ON_DELIVERY)).toBe(false);
    expect(PaymentStateMachine.isOnline(PaymentMethod.WALLET)).toBe(false);
  });

  it('marks failed, cancelled and fully refunded as terminal', () => {
    expect(PaymentStateMachine.isTerminal(PaymentStatus.FAILED)).toBe(true);
    expect(PaymentStateMachine.isTerminal(PaymentStatus.CANCELLED)).toBe(true);
    expect(PaymentStateMachine.isTerminal(PaymentStatus.REFUNDED)).toBe(true);
    expect(PaymentStateMachine.isTerminal(PaymentStatus.PAID)).toBe(false);
  });
});

describe('PaymentStateMachine.refundableAmount', () => {
  it('returns the whole amount when nothing has been returned', () => {
    expect(PaymentStateMachine.refundableAmount(PaymentStatus.PAID, 1000, 0)).toBe(1000);
  });

  it('returns only the remainder after a partial refund', () => {
    expect(PaymentStateMachine.refundableAmount(PaymentStatus.PARTIALLY_REFUNDED, 1000, 250)).toBe(
      750,
    );
  });

  it('refuses a payment that was never collected', () => {
    expect(() => PaymentStateMachine.refundableAmount(PaymentStatus.PENDING, 1000, 0)).toThrow(
      /not been collected yet/,
    );
  });

  it('refuses a failed attempt', () => {
    expect(() => PaymentStateMachine.refundableAmount(PaymentStatus.FAILED, 1000, 0)).toThrow(
      /never collected/,
    );
  });

  it('refuses once everything has been returned', () => {
    expect(() => PaymentStateMachine.refundableAmount(PaymentStatus.REFUNDED, 1000, 1000)).toThrow(
      /already been refunded in full/,
    );
  });

  it('rounds to two decimals rather than leaking floating-point dust', () => {
    expect(PaymentStateMachine.refundableAmount(PaymentStatus.PAID, 100.1, 0.2)).toBe(99.9);
  });
});

describe('PaymentStateMachine.statusAfterRefund', () => {
  it('is partially refunded while something is left', () => {
    expect(PaymentStateMachine.statusAfterRefund(1000, 250)).toBe(PaymentStatus.PARTIALLY_REFUNDED);
  });

  it('is fully refunded once the whole amount is back', () => {
    expect(PaymentStateMachine.statusAfterRefund(1000, 1000)).toBe(PaymentStatus.REFUNDED);
  });

  it('treats an over-refund as full rather than inventing a state', () => {
    expect(PaymentStateMachine.statusAfterRefund(1000, 1001)).toBe(PaymentStatus.REFUNDED);
  });
});

describe('PaymentStateMachine.describe', () => {
  it('tells a cash customer to pay the rider rather than "waiting for payment"', () => {
    expect(
      PaymentStateMachine.describe(PaymentStatus.PENDING, PaymentMethod.CASH_ON_DELIVERY),
    ).toBe('Pay the rider when your order arrives');
  });

  it('says a gateway payment is waiting', () => {
    expect(PaymentStateMachine.describe(PaymentStatus.PENDING, PaymentMethod.JAZZCASH)).toBe(
      'Waiting for payment',
    );
  });

  it('has wording for every status', () => {
    for (const status of Object.values(PaymentStatus)) {
      expect(PaymentStateMachine.describe(status, PaymentMethod.JAZZCASH)).toBeTruthy();
    }
  });
});
