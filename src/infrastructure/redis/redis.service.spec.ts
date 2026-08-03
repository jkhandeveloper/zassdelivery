import type { LoggerService } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import type Redis from 'ioredis';

import type { redisConfig } from '@/config';

import { RedisService } from './redis.service';

/**
 * ioredis is mocked at the module boundary: `RedisService` builds its client in
 * the constructor, so the double has to be in place before instantiation.
 */
const clientMock = {
  on: jest.fn(),
  connect: jest.fn().mockResolvedValue(undefined),
  quit: jest.fn().mockResolvedValue('OK'),
  ping: jest.fn(),
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
  exists: jest.fn(),
  incr: jest.fn(),
  expire: jest.fn(),
  ttl: jest.fn(),
  scan: jest.fn(),
};

jest.mock('ioredis', () => ({
  __esModule: true,
  default: jest.fn(() => clientMock),
}));

const config: ConfigType<typeof redisConfig> = {
  host: 'localhost',
  port: 6379,
  password: undefined,
  db: 0,
  keyPrefix: 'zass:',
  connectTimeoutMs: 10000,
  commandTimeoutMs: 5000,
  maxRetriesPerRequest: 3,
};

describe('RedisService', () => {
  let service: RedisService;
  let logger: LoggerService;

  beforeEach(() => {
    jest.clearAllMocks();
    logger = {
      log: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      verbose: jest.fn(),
    };
    service = new RedisService(config, logger);
  });

  describe('lifecycle', () => {
    it('connects explicitly on module init', async () => {
      await service.onModuleInit();
      expect(clientMock.connect).toHaveBeenCalledTimes(1);
    });

    it('quits cleanly on module destroy', async () => {
      await service.onModuleDestroy();
      expect(clientMock.quit).toHaveBeenCalledTimes(1);
    });

    it('exposes the raw client for advanced commands', () => {
      expect(service.getClient()).toBe(clientMock as unknown as Redis);
    });
  });

  describe('ping', () => {
    it('returns true on PONG', async () => {
      clientMock.ping.mockResolvedValue('PONG');
      await expect(service.ping()).resolves.toBe(true);
    });

    it('returns false on any other reply', async () => {
      clientMock.ping.mockResolvedValue('nope');
      await expect(service.ping()).resolves.toBe(false);
    });
  });

  describe('set', () => {
    it('applies a TTL when one is supplied', async () => {
      await service.set('k', 'v', 60);
      expect(clientMock.set).toHaveBeenCalledWith('k', 'v', 'EX', 60);
    });

    it('omits the TTL when none is given', async () => {
      await service.set('k', 'v');
      expect(clientMock.set).toHaveBeenCalledWith('k', 'v');
    });

    it('treats a zero TTL as no expiry rather than expiring immediately', async () => {
      await service.set('k', 'v', 0);
      expect(clientMock.set).toHaveBeenCalledWith('k', 'v');
    });
  });

  describe('setIfAbsent', () => {
    it('reports true when this call created the key', async () => {
      clientMock.set.mockResolvedValue('OK');
      await expect(service.setIfAbsent('lock', '1', 30)).resolves.toBe(true);
      expect(clientMock.set).toHaveBeenCalledWith('lock', '1', 'EX', 30, 'NX');
    });

    it('reports false when the key already existed', async () => {
      clientMock.set.mockResolvedValue(null);
      await expect(service.setIfAbsent('lock', '1', 30)).resolves.toBe(false);
    });
  });

  describe('getJson', () => {
    it('parses stored JSON', async () => {
      clientMock.get.mockResolvedValue('{"a":1}');
      await expect(service.getJson<{ a: number }>('k')).resolves.toEqual({ a: 1 });
    });

    it('returns null for a missing key', async () => {
      clientMock.get.mockResolvedValue(null);
      await expect(service.getJson('k')).resolves.toBeNull();
    });

    it('drops a poisoned entry instead of throwing at the call site', async () => {
      clientMock.get.mockResolvedValue('{not json');

      await expect(service.getJson('k')).resolves.toBeNull();
      // The bad value is deleted so the next read is a clean cache miss.
      expect(clientMock.del).toHaveBeenCalledWith('k');
    });
  });

  describe('delete', () => {
    it('short-circuits on an empty key list rather than issuing DEL', async () => {
      await expect(service.delete()).resolves.toBe(0);
      expect(clientMock.del).not.toHaveBeenCalled();
    });

    it('forwards multiple keys', async () => {
      clientMock.del.mockResolvedValue(2);
      await expect(service.delete('a', 'b')).resolves.toBe(2);
      expect(clientMock.del).toHaveBeenCalledWith('a', 'b');
    });
  });

  describe('increment', () => {
    it('arms the TTL only when the counter is created', async () => {
      clientMock.incr.mockResolvedValue(1);

      await service.increment('rate:1', 60);

      expect(clientMock.expire).toHaveBeenCalledWith('rate:1', 60);
    });

    it('does not re-arm the TTL on subsequent hits', async () => {
      clientMock.incr.mockResolvedValue(4);

      // Re-arming here would let a caller slide the window forever and escape
      // the rate limit entirely.
      await service.increment('rate:1', 60);

      expect(clientMock.expire).not.toHaveBeenCalled();
    });
  });

  describe('exists', () => {
    it('maps the numeric reply to a boolean', async () => {
      clientMock.exists.mockResolvedValue(1);
      await expect(service.exists('k')).resolves.toBe(true);

      clientMock.exists.mockResolvedValue(0);
      await expect(service.exists('k')).resolves.toBe(false);
    });
  });

  describe('deleteByPattern', () => {
    it('scans until the cursor wraps and strips the prefix before deleting', async () => {
      clientMock.scan
        .mockResolvedValueOnce(['7', ['zass:otp:1', 'zass:otp:2']])
        .mockResolvedValueOnce(['0', ['zass:otp:3']]);
      clientMock.del.mockResolvedValueOnce(2).mockResolvedValueOnce(1);

      const removed = await service.deleteByPattern('otp:*');

      expect(removed).toBe(3);
      expect(clientMock.scan).toHaveBeenCalledTimes(2);
      // ioredis re-applies keyPrefix on write commands, so the prefix returned
      // by SCAN must be stripped or the DEL would target "zass:zass:otp:1".
      expect(clientMock.del).toHaveBeenNthCalledWith(1, 'otp:1', 'otp:2');
      expect(clientMock.del).toHaveBeenNthCalledWith(2, 'otp:3');
    });

    it('handles a scan that matches nothing', async () => {
      clientMock.scan.mockResolvedValueOnce(['0', []]);

      await expect(service.deleteByPattern('none:*')).resolves.toBe(0);
      expect(clientMock.del).not.toHaveBeenCalled();
    });
  });
});
