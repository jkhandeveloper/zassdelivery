import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import { BusinessRuleViolationException } from '@/common/exceptions/domain.exception';

/** Digits in a delivery confirmation code. */
export const OTP_LENGTH = 4;

/**
 * How many wrong codes a rider may enter before the code is burned.
 *
 * Four digits is only ten thousand combinations, so an unbounded retry loop
 * would let a rider close a delivery they never made. Five attempts is enough
 * for a customer reading a code aloud on a noisy street and nowhere near
 * enough to guess one.
 */
export const OTP_MAX_ATTEMPTS = 5;

/** Minutes a code stays valid after the rider collects the order. */
export const OTP_TTL_MINUTES = 120;

export interface OtpState {
  hash: string | null;
  issuedAt: Date | null;
  attempts: number;
  verifiedAt: Date | null;
}

/**
 * Issues and checks the code a customer reads out to close a delivery.
 *
 * The plaintext is generated here, handed straight to the customer's
 * notification and then forgotten: only a hash is ever stored, so a leaked
 * database row cannot be used to mark someone else's order delivered.
 *
 * The hash is a keyed SHA-256 rather than a password hash. A four-digit code
 * has no entropy worth protecting with argon2 — its security comes from the
 * attempt cap and the expiry — and delivery confirmation happens on the
 * doorstep, where an argon2 verification per attempt is latency the rider
 * would feel.
 */
@Injectable()
export class DeliveryOtpService {
  /** A fresh code, returned in clear exactly once. */
  generate(): string {
    return String(randomInt(0, 10 ** OTP_LENGTH)).padStart(OTP_LENGTH, '0');
  }

  hash(code: string, salt: string): string {
    // The assignment id is the salt, so the same code issued for two deliveries
    // does not produce the same stored hash.
    return createHmac('sha256', salt).update(code).digest('hex');
  }

  /**
   * Checks a code against the stored hash and explains any refusal.
   *
   * Every failure path is a business rule violation rather than a bare false,
   * so the rider is told whether the code is wrong, stale or spent — guessing
   * at the door helps nobody.
   */
  verify(code: string, state: OtpState, salt: string, now: Date = new Date()): void {
    if (state.hash === null || state.issuedAt === null) {
      throw new BusinessRuleViolationException(
        'No delivery code has been issued for this order yet. Collect the order first.',
      );
    }

    if (state.verifiedAt !== null) {
      throw new BusinessRuleViolationException('This delivery has already been confirmed.');
    }

    if (state.attempts >= OTP_MAX_ATTEMPTS) {
      throw new BusinessRuleViolationException(
        'Too many incorrect codes. Contact support to complete this delivery.',
      );
    }

    const expiresAt = new Date(state.issuedAt.getTime() + OTP_TTL_MINUTES * 60_000);

    if (now > expiresAt) {
      throw new BusinessRuleViolationException(
        'This delivery code has expired. Contact support to complete the delivery.',
      );
    }

    if (!this.matches(code, state.hash, salt)) {
      const remaining = OTP_MAX_ATTEMPTS - state.attempts - 1;

      throw new BusinessRuleViolationException(
        remaining > 0
          ? `That code is not correct. ${remaining} attempt(s) remaining.`
          : 'That code is not correct, and no attempts remain. Contact support.',
      );
    }
  }

  /** Constant-time comparison, so a wrong code leaks nothing by how long it took. */
  private matches(code: string, storedHash: string, salt: string): boolean {
    const candidate = Buffer.from(this.hash(code, salt), 'hex');
    const expected = Buffer.from(storedHash, 'hex');

    if (candidate.length !== expected.length) {
      return false;
    }

    return timingSafeEqual(candidate, expected);
  }
}
