import { PaymentMethod, PaymentStatus } from '@prisma/client';

import { BusinessRuleViolationException } from '@/common/exceptions/domain.exception';

/**
 * The payment lifecycle, declared as data.
 *
 * As with the order and rider lifecycles, the legal moves live in one table
 * rather than scattered through the code that makes them. Money is the worst
 * possible place for an accidental path: a payment that goes from REFUNDED back
 * to PAID has invented money, and nothing downstream would notice.
 */
export const PAYMENT_TRANSITIONS: Record<PaymentStatus, PaymentStatus[]> = {
  [PaymentStatus.PENDING]: [
    PaymentStatus.AUTHORIZED,
    PaymentStatus.PAID,
    PaymentStatus.FAILED,
    PaymentStatus.CANCELLED,
  ],
  // Authorised means the gateway has ring-fenced the money but not moved it.
  [PaymentStatus.AUTHORIZED]: [PaymentStatus.PAID, PaymentStatus.FAILED, PaymentStatus.CANCELLED],
  [PaymentStatus.PAID]: [PaymentStatus.PARTIALLY_REFUNDED, PaymentStatus.REFUNDED],
  // A partial refund can always be topped up to a full one.
  [PaymentStatus.PARTIALLY_REFUNDED]: [PaymentStatus.REFUNDED],
  // Terminal. A failed attempt is never revived — the customer starts a new one,
  // which keeps one row per attempt and a truthful history.
  [PaymentStatus.FAILED]: [],
  [PaymentStatus.CANCELLED]: [],
  [PaymentStatus.REFUNDED]: [],
};

/** Statuses in which the money has actually arrived. */
export const SETTLED_STATUSES: PaymentStatus[] = [
  PaymentStatus.PAID,
  PaymentStatus.PARTIALLY_REFUNDED,
  PaymentStatus.REFUNDED,
];

/** Statuses in which an attempt is still open and could still settle. */
export const OPEN_STATUSES: PaymentStatus[] = [PaymentStatus.PENDING, PaymentStatus.AUTHORIZED];

/** Methods that send the customer to a gateway rather than settling in-house. */
export const ONLINE_METHODS: PaymentMethod[] = [
  PaymentMethod.JAZZCASH,
  PaymentMethod.EASYPAISA,
  PaymentMethod.CARD,
];

/** Methods the platform settles itself, with no third party involved. */
export const OFFLINE_METHODS: PaymentMethod[] = [
  PaymentMethod.CASH_ON_DELIVERY,
  PaymentMethod.WALLET,
  PaymentMethod.BANK_TRANSFER,
];

export class PaymentStateMachine {
  static isOnline(method: PaymentMethod): boolean {
    return ONLINE_METHODS.includes(method);
  }

  static isSettled(status: PaymentStatus): boolean {
    return SETTLED_STATUSES.includes(status);
  }

  static isOpen(status: PaymentStatus): boolean {
    return OPEN_STATUSES.includes(status);
  }

  static isTerminal(status: PaymentStatus): boolean {
    return PAYMENT_TRANSITIONS[status].length === 0;
  }

  /** Validates a move and explains the refusal in the caller's terms. */
  static assertTransition(from: PaymentStatus, to: PaymentStatus): void {
    if (from === to) {
      throw new BusinessRuleViolationException(`This payment is already ${from.toLowerCase()}.`);
    }

    if (!PAYMENT_TRANSITIONS[from].includes(to)) {
      const allowed = PAYMENT_TRANSITIONS[from];

      throw new BusinessRuleViolationException(
        `A payment cannot move from ${from} to ${to}. Allowed: ${allowed.join(', ') || 'none'}.`,
      );
    }
  }

  /**
   * How much of a payment can still be given back.
   *
   * Guards the two ways a refund goes wrong: returning more than was taken,
   * which invents money, and returning anything against an attempt that never
   * collected any.
   */
  static refundableAmount(status: PaymentStatus, amount: number, alreadyRefunded: number): number {
    if (!this.isSettled(status)) {
      throw new BusinessRuleViolationException(
        status === PaymentStatus.PENDING || status === PaymentStatus.AUTHORIZED
          ? 'This payment has not been collected yet, so there is nothing to refund. Cancel it instead.'
          : `This payment is ${status.toLowerCase()} and was never collected.`,
      );
    }

    const remaining = Math.round((amount - alreadyRefunded) * 100) / 100;

    if (remaining <= 0) {
      throw new BusinessRuleViolationException('This payment has already been refunded in full.');
    }

    return remaining;
  }

  /** The status a payment lands in once a refund of this size is applied. */
  static statusAfterRefund(amount: number, refundedInTotal: number): PaymentStatus {
    return refundedInTotal >= amount ? PaymentStatus.REFUNDED : PaymentStatus.PARTIALLY_REFUNDED;
  }

  /** Customer-facing wording for a payment state. */
  static describe(status: PaymentStatus, method: PaymentMethod): string {
    if (status === PaymentStatus.PENDING && method === PaymentMethod.CASH_ON_DELIVERY) {
      return 'Pay the rider when your order arrives';
    }

    const text: Record<PaymentStatus, string> = {
      [PaymentStatus.PENDING]: 'Waiting for payment',
      [PaymentStatus.AUTHORIZED]: 'Authorised — awaiting capture',
      [PaymentStatus.PAID]: 'Paid',
      [PaymentStatus.FAILED]: 'Payment failed',
      [PaymentStatus.CANCELLED]: 'Payment cancelled',
      [PaymentStatus.REFUNDED]: 'Refunded in full',
      [PaymentStatus.PARTIALLY_REFUNDED]: 'Partially refunded',
    };

    return text[status];
  }
}
