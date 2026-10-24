import { BusinessRuleViolationException } from '@/common/exceptions/domain.exception';

import {
  DeliveryOtpService,
  OTP_LENGTH,
  OTP_MAX_ATTEMPTS,
  OTP_TTL_MINUTES,
  type OtpState,
} from './delivery-otp.service';

const SALT = 'assignment-abc123';
const ISSUED_AT = new Date('2026-08-09T18:00:00.000Z');

describe('DeliveryOtpService.generate', () => {
  const service = new DeliveryOtpService();

  it('produces a code of the documented length', () => {
    expect(service.generate()).toHaveLength(OTP_LENGTH);
  });

  it('produces digits only, keeping leading zeros', () => {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      expect(service.generate()).toMatch(/^\d{4}$/);
    }
  });

  it('does not return the same code every time', () => {
    const codes = new Set(Array.from({ length: 40 }, () => service.generate()));

    expect(codes.size).toBeGreaterThan(1);
  });
});

describe('DeliveryOtpService.hash', () => {
  const service = new DeliveryOtpService();

  it('never returns the code itself', () => {
    expect(service.hash('4821', SALT)).not.toContain('4821');
  });

  it('is stable for the same code and assignment', () => {
    expect(service.hash('4821', SALT)).toBe(service.hash('4821', SALT));
  });

  it('gives the same code a different hash on a different delivery', () => {
    expect(service.hash('4821', SALT)).not.toBe(service.hash('4821', 'assignment-other'));
  });
});

describe('DeliveryOtpService.verify', () => {
  const service = new DeliveryOtpService();

  function state(overrides: Partial<OtpState> = {}): OtpState {
    return {
      hash: service.hash('4821', SALT),
      issuedAt: ISSUED_AT,
      attempts: 0,
      verifiedAt: null,
      ...overrides,
    };
  }

  it('accepts the correct code', () => {
    expect(() => service.verify('4821', state(), SALT, ISSUED_AT)).not.toThrow();
  });

  it('rejects a wrong code and says how many attempts remain', () => {
    expect(() => service.verify('0000', state(), SALT, ISSUED_AT)).toThrow(
      /4 attempt\(s\) remaining/,
    );
  });

  it('warns on the final attempt that none remain', () => {
    expect(() =>
      service.verify('0000', state({ attempts: OTP_MAX_ATTEMPTS - 1 }), SALT, ISSUED_AT),
    ).toThrow(/no attempts remain/);
  });

  it('refuses any further attempt once the cap is reached', () => {
    // The correct code is supplied here: after the cap it must still be refused,
    // or the limit is only a suggestion.
    expect(() =>
      service.verify('4821', state({ attempts: OTP_MAX_ATTEMPTS }), SALT, ISSUED_AT),
    ).toThrow(/Too many incorrect codes/);
  });

  it('refuses a code that was never issued', () => {
    expect(() =>
      service.verify('4821', state({ hash: null, issuedAt: null }), SALT, ISSUED_AT),
    ).toThrow(/Collect the order first/);
  });

  it('refuses to confirm the same delivery twice', () => {
    expect(() => service.verify('4821', state({ verifiedAt: ISSUED_AT }), SALT, ISSUED_AT)).toThrow(
      /already been confirmed/,
    );
  });

  it('refuses a code past its time to live', () => {
    const tooLate = new Date(ISSUED_AT.getTime() + (OTP_TTL_MINUTES + 1) * 60_000);

    expect(() => service.verify('4821', state(), SALT, tooLate)).toThrow(/expired/);
  });

  it('still accepts a code on the last minute of its window', () => {
    const justInTime = new Date(ISSUED_AT.getTime() + (OTP_TTL_MINUTES - 1) * 60_000);

    expect(() => service.verify('4821', state(), SALT, justInTime)).not.toThrow();
  });

  it('rejects a code issued for a different delivery', () => {
    const otherDelivery = state({ hash: service.hash('4821', 'assignment-other') });

    expect(() => service.verify('4821', otherDelivery, SALT, ISSUED_AT)).toThrow(
      BusinessRuleViolationException,
    );
  });

  it('rejects a malformed code without throwing anything unexpected', () => {
    expect(() => service.verify('not-a-code', state(), SALT, ISSUED_AT)).toThrow(
      BusinessRuleViolationException,
    );
  });
});
