import type { LoggerService } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';

import type { jwtConfig } from '@/config';
import type { RedisService } from '@/infrastructure/redis/redis.service';

import { SmsSender } from '../../domain/services/sms-sender';
import { OTP_DAILY_LIMIT, OTP_MAX_ATTEMPTS, PhoneOtpService } from './phone-otp.service';

const PHONE = '+923001234567';

/** Just enough of Redis, in memory, with TTLs that never run out. */
function fakeRedis() {
  const store = new Map<string, string>();

  return {
    store,
    redis: {
      get: jest.fn((key: string) => Promise.resolve(store.get(key) ?? null)),
      setIfAbsent: jest.fn((key: string, value: string) => {
        if (store.has(key)) {
          return Promise.resolve(false);
        }
        store.set(key, value);
        return Promise.resolve(true);
      }),
      increment: jest.fn((key: string) => {
        const next = Number(store.get(key) ?? 0) + 1;
        store.set(key, String(next));
        return Promise.resolve(next);
      }),
      getJson: jest.fn((key: string) => {
        const raw = store.get(key);
        return Promise.resolve(raw === undefined ? null : (JSON.parse(raw) as unknown));
      }),
      setJson: jest.fn((key: string, value: unknown) => {
        store.set(key, JSON.stringify(value));
        return Promise.resolve();
      }),
      delete: jest.fn((...keys: string[]) => {
        keys.forEach((key) => store.delete(key));
        return Promise.resolve(keys.length);
      }),
      ttl: jest.fn(() => Promise.resolve(120)),
    } as unknown as RedisService,
  };
}

class FakeSms extends SmsSender {
  readonly name = 'fake';
  sent: Array<{ to: string; message: string }> = [];
  configured = true;
  failing = false;

  isConfigured(): boolean {
    return this.configured;
  }

  send(to: string, message: string): Promise<void> {
    if (this.failing) {
      return Promise.reject(new Error('gateway down'));
    }
    this.sent.push({ to, message });
    return Promise.resolve();
  }

  /** The six digits in the last message. */
  lastCode(): string {
    return /\d{6}/.exec(this.sent.at(-1)?.message ?? '')?.[0] ?? '';
  }
}

const logger = { error: jest.fn(), warn: jest.fn(), log: jest.fn() } as unknown as LoggerService;

function build() {
  const { redis, store } = fakeRedis();
  const sms = new FakeSms();
  const service = new PhoneOtpService(
    redis,
    sms,
    { accessSecret: 'test-secret' } as ConfigType<typeof jwtConfig>,
    logger,
  );

  return { service, sms, store };
}

describe('PhoneOtpService', () => {
  it('texts a six-digit code that verifies once', async () => {
    const { service, sms } = build();

    await service.send(PHONE, 'register');

    expect(sms.sent).toHaveLength(1);
    expect(sms.sent[0]?.to).toBe(PHONE);

    await expect(service.verify(PHONE, 'register', sms.lastCode())).resolves.toBeUndefined();
    // Spent: the same code does not work twice.
    await expect(service.verify(PHONE, 'register', sms.lastCode())).rejects.toThrow(/expired/);
  });

  it('never stores the code itself', async () => {
    const { service, sms, store } = build();

    await service.send(PHONE, 'register');

    const stored = [...store.values()].join(' ');
    expect(stored).not.toContain(sms.lastCode());
  });

  it('does not accept a sign-up code for signing in', async () => {
    const { service, sms } = build();

    await service.send(PHONE, 'register');

    await expect(service.verify(PHONE, 'login', sms.lastCode())).rejects.toThrow(/expired/);
  });

  it('counts wrong codes and burns the code after the last try', async () => {
    const { service, sms } = build();

    await service.send(PHONE, 'login');
    const right = sms.lastCode();
    const wrong = right === '000000' ? '111111' : '000000';

    for (let attempt = 1; attempt < OTP_MAX_ATTEMPTS; attempt += 1) {
      await expect(service.verify(PHONE, 'login', wrong)).rejects.toThrow(/(try|tries) left/);
    }

    await expect(service.verify(PHONE, 'login', wrong)).rejects.toThrow(/cancelled/);
    await expect(service.verify(PHONE, 'login', right)).rejects.toThrow(/new one/);
  });

  it('makes a second request wait out the resend window', async () => {
    const { service } = build();

    await service.send(PHONE, 'register');

    await expect(service.send(PHONE, 'register')).rejects.toThrow(/just sent/);
  });

  it('stops sending to one number after the daily limit', async () => {
    const { service, store } = build();

    for (let sent = 0; sent < OTP_DAILY_LIMIT; sent += 1) {
      await service.send(PHONE, 'register');
      store.delete(`auth:otp:cooldown:register:${PHONE}`);
    }

    await expect(service.send(PHONE, 'register')).rejects.toThrow(/today/);
  });

  it('leaves nothing to verify, and no wait, when the text could not be sent', async () => {
    const { service, sms } = build();

    sms.failing = true;
    await expect(service.send(PHONE, 'register')).rejects.toThrow(/couldn't send/);

    sms.failing = false;
    await expect(service.send(PHONE, 'register')).resolves.toMatchObject({ enabled: true });
  });

  it('is switched off when no sender is configured', async () => {
    const { service, sms } = build();

    sms.configured = false;

    expect(service.settings().enabled).toBe(false);
    await expect(service.send(PHONE, 'register')).rejects.toThrow(/not available/);
  });
});
