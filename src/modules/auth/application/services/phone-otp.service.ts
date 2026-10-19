import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';

import { Inject, Injectable, type LoggerService } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';

import { appConfig, jwtConfig } from '@/config';
import { BusinessRuleViolationException } from '@/common/exceptions/domain.exception';
import { RedisService } from '@/infrastructure/redis/redis.service';

import { SmsSender } from '../../domain/services/sms-sender';

/** What a code is for. A sign-up code cannot be spent signing in, or the reverse. */
export type OtpPurpose = 'register' | 'login';

export const OTP_CODE_LENGTH = 6;

/** How long a code stays valid. Long enough for a slow SIM, short enough to be useless later. */
export const OTP_TTL_SECONDS = 5 * 60;

/** The wait before another code may be sent to the same number. */
export const OTP_RESEND_SECONDS = 60;

/** Wrong guesses before a code is burned. Six digits and five tries is a one-in-200,000 chance. */
export const OTP_MAX_ATTEMPTS = 5;

/**
 * Codes one number may be sent in a day.
 *
 * The texts go out from the platform's own SIM, so this is what stops somebody
 * scripting the form from spending its bundle — or from using it to flood a
 * stranger's phone.
 */
export const OTP_DAILY_LIMIT = 8;

interface StoredCode {
  hash: string;
  attempts: number;
}

export interface OtpSettings {
  enabled: boolean;
  codeLength: number;
  expiresInSeconds: number;
  resendAfterSeconds: number;
}

/**
 * Sends and checks the six-digit codes that prove someone holds a phone.
 *
 * Codes live in Redis, never the database: they matter for five minutes and
 * then not at all. Only a keyed hash is kept, so reading Redis does not hand
 * anyone a working code.
 *
 * Verification is on exactly when an SMS sender is configured. A production
 * deployment that has not set one up yet keeps registering people as before,
 * rather than turning away every new customer for a text that cannot be sent.
 */
@Injectable()
export class PhoneOtpService {
  constructor(
    private readonly redis: RedisService,
    private readonly sms: SmsSender,
    @Inject(jwtConfig.KEY)
    private readonly jwt: ConfigType<typeof jwtConfig>,
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: LoggerService,
    @Inject(appConfig.KEY)
    private readonly app: Pick<ConfigType<typeof appConfig>, 'devOtpCode'>,
  ) {}

  get enabled(): boolean {
    return this.sms.isConfigured();
  }

  settings(): OtpSettings {
    return {
      enabled: this.enabled,
      codeLength: OTP_CODE_LENGTH,
      expiresInSeconds: OTP_TTL_SECONDS,
      resendAfterSeconds: OTP_RESEND_SECONDS,
    };
  }

  async send(phone: string, purpose: OtpPurpose): Promise<OtpSettings> {
    if (!this.enabled) {
      throw new BusinessRuleViolationException('Phone verification is not available right now.');
    }

    const cooldownKey = this.key('cooldown', purpose, phone);

    if (!(await this.redis.setIfAbsent(cooldownKey, '1', OTP_RESEND_SECONDS))) {
      const wait = Math.max(await this.redis.ttl(cooldownKey), 1);

      throw new BusinessRuleViolationException(
        `A code was just sent. You can ask for another in ${wait} seconds.`,
      );
    }

    const sentToday = await this.redis.increment(this.key('daily', purpose, phone), 24 * 3600);

    if (sentToday > OTP_DAILY_LIMIT) {
      throw new BusinessRuleViolationException(
        'Too many codes have been sent to this number today. Try again tomorrow, or contact support.',
      );
    }

    const code =
      this.app.devOtpCode ??
      String(randomInt(0, 10 ** OTP_CODE_LENGTH)).padStart(OTP_CODE_LENGTH, '0');
    const codeKey = this.key('code', purpose, phone);

    await this.redis.setJson<StoredCode>(
      codeKey,
      { hash: this.hash(code, purpose, phone), attempts: 0 },
      OTP_TTL_SECONDS,
    );

    try {
      await this.sms.send(
        phone,
        `${code} is your ZassDelivery verification code. It expires in ` +
          `${OTP_TTL_SECONDS / 60} minutes. Never share it with anyone.`,
      );
    } catch (error) {
      // Nothing reached the phone, so nothing should be left to verify — and
      // the person should be able to try again straight away.
      await this.redis.delete(codeKey, cooldownKey);

      this.logger.error?.(
        `Could not send a ${purpose} code through ${this.sms.name}: ${(error as Error).message}`,
        undefined,
        PhoneOtpService.name,
      );

      throw new BusinessRuleViolationException(
        "We couldn't send a text to this number just now. Please try again in a minute.",
      );
    }

    return this.settings();
  }

  /** Spends a code. Throws, saying why, unless it is the right one and still live. */
  async verify(phone: string, purpose: OtpPurpose, code: string): Promise<void> {
    const codeKey = this.key('code', purpose, phone);

    // Developer testing: the fixed code works whether or not one was sent.
    if (this.app.devOtpCode !== null && code.trim() === this.app.devOtpCode) {
      await this.redis.delete(codeKey);
      return;
    }
    const stored = await this.redis.getJson<StoredCode>(codeKey);

    if (stored === null) {
      throw new BusinessRuleViolationException(
        'This code has expired or was never sent. Ask for a new one.',
      );
    }

    if (stored.attempts >= OTP_MAX_ATTEMPTS) {
      await this.redis.delete(codeKey);

      throw new BusinessRuleViolationException('Too many wrong codes. Ask for a new one.');
    }

    const expected = Buffer.from(stored.hash, 'hex');
    const given = Buffer.from(this.hash(code.trim(), purpose, phone), 'hex');

    if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
      // The attempt is counted against the code's own remaining lifetime, so a
      // wrong guess never extends how long the code can be guessed at.
      const remaining = await this.redis.ttl(codeKey);

      if (remaining > 0) {
        await this.redis.setJson<StoredCode>(
          codeKey,
          { ...stored, attempts: stored.attempts + 1 },
          remaining,
        );
      }

      const left = OTP_MAX_ATTEMPTS - stored.attempts - 1;

      throw new BusinessRuleViolationException(
        left > 0
          ? `That code isn't right. ${left} ${left === 1 ? 'try' : 'tries'} left.`
          : "That code isn't right, and it has now been cancelled. Ask for a new one.",
      );
    }

    await this.redis.delete(codeKey);
  }

  private hash(code: string, purpose: OtpPurpose, phone: string): string {
    // Keyed with a server secret and salted with the number and purpose, so a
    // copy of Redis cannot be brute-forced offline into working codes.
    return createHmac('sha256', this.jwt.accessSecret)
      .update(`${purpose}:${phone}:${code}`)
      .digest('hex');
  }

  private key(kind: 'code' | 'cooldown' | 'daily', purpose: OtpPurpose, phone: string): string {
    return `auth:otp:${kind}:${purpose}:${phone}`;
  }
}
