import type { LoggerService } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import type { Prisma } from '@prisma/client';

import type { databaseConfig } from '@/config';

import { PrismaService } from './prisma.service';

type LogHandler = (event: Prisma.LogEvent) => void;
type QueryHandler = (event: Prisma.QueryEvent) => void;

const config = (
  overrides: Partial<ConfigType<typeof databaseConfig>> = {},
): ConfigType<typeof databaseConfig> => ({
  url: 'postgresql://user:pass@localhost:5432/db?schema=public',
  slowQueryThresholdMs: 300,
  logQueries: false,
  ...overrides,
});

const queryEvent = (duration: number): Prisma.QueryEvent => ({
  timestamp: new Date(),
  query: 'SELECT * FROM "users"',
  params: '[]',
  duration,
  target: 'quaint',
});

describe('PrismaService', () => {
  let logger: LoggerService;

  beforeEach(() => {
    logger = {
      log: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      verbose: jest.fn(),
    };
  });

  describe('healthCheck', () => {
    it('resolves true when the probe query round-trips', async () => {
      const service = new PrismaService(config(), logger);
      jest.spyOn(service, '$queryRaw').mockResolvedValue([{ '?column?': 1 }]);

      await expect(service.healthCheck()).resolves.toBe(true);
    });

    it('propagates the failure so the readiness probe can report it', async () => {
      const service = new PrismaService(config(), logger);
      jest.spyOn(service, '$queryRaw').mockRejectedValue(new Error('ECONNREFUSED'));

      await expect(service.healthCheck()).rejects.toThrow('ECONNREFUSED');
    });
  });

  describe('truncateAll', () => {
    const originalNodeEnv = process.env.NODE_ENV;

    afterEach(() => {
      process.env.NODE_ENV = originalNodeEnv;
    });

    it('refuses to run in production', async () => {
      process.env.NODE_ENV = 'production';
      const service = new PrismaService(config(), logger);

      // This helper wipes every table; an accidental production call would be
      // unrecoverable, so the guard is asserted explicitly.
      await expect(service.truncateAll()).rejects.toThrow(/disabled in production/);
    });

    it('does nothing when there are no tables', async () => {
      process.env.NODE_ENV = 'test';
      const service = new PrismaService(config(), logger);
      jest.spyOn(service, '$queryRaw').mockResolvedValue([]);
      const executeRaw = jest.spyOn(service, '$executeRawUnsafe').mockResolvedValue(0);

      await service.truncateAll();

      expect(executeRaw).not.toHaveBeenCalled();
    });

    it('truncates every discovered table in a single statement', async () => {
      process.env.NODE_ENV = 'test';
      const service = new PrismaService(config(), logger);
      jest
        .spyOn(service, '$queryRaw')
        .mockResolvedValue([{ tablename: 'users' }, { tablename: 'addresses' }]);
      const executeRaw = jest.spyOn(service, '$executeRawUnsafe').mockResolvedValue(0);

      await service.truncateAll();

      expect(executeRaw).toHaveBeenCalledWith(
        'TRUNCATE TABLE "public"."users", "public"."addresses" RESTART IDENTITY CASCADE',
      );
    });
  });

  describe('engine log forwarding', () => {
    /** Registers the handlers without opening a real connection. */
    function captureHandlers(service: PrismaService): Map<string, LogHandler | QueryHandler> {
      const handlers = new Map<string, LogHandler | QueryHandler>();
      jest
        .spyOn(service, '$on')
        .mockImplementation((event: string, handler: LogHandler | QueryHandler) => {
          handlers.set(event, handler);
          return undefined as never;
        });

      (service as unknown as { registerLogForwarding(): void }).registerLogForwarding();
      return handlers;
    }

    it('warns on a query slower than the configured threshold', () => {
      const service = new PrismaService(config({ slowQueryThresholdMs: 100 }), logger);
      const handlers = captureHandlers(service);

      (handlers.get('query') as QueryHandler)(queryEvent(250));

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Slow query (250ms)'),
        'PrismaService',
      );
    });

    it('stays silent for a fast query when query logging is off', () => {
      const service = new PrismaService(config({ slowQueryThresholdMs: 100 }), logger);
      const handlers = captureHandlers(service);

      (handlers.get('query') as QueryHandler)(queryEvent(5));

      expect(logger.warn).not.toHaveBeenCalled();
      expect(logger.debug).not.toHaveBeenCalled();
    });

    it('emits fast queries at debug when query logging is enabled', () => {
      const service = new PrismaService(
        config({ slowQueryThresholdMs: 100, logQueries: true }),
        logger,
      );
      const handlers = captureHandlers(service);

      (handlers.get('query') as QueryHandler)(queryEvent(5));

      expect(logger.debug).toHaveBeenCalled();
    });

    it('forwards engine warnings and errors to the logger', () => {
      const service = new PrismaService(config(), logger);
      const handlers = captureHandlers(service);

      (handlers.get('warn') as LogHandler)({
        timestamp: new Date(),
        message: 'a warning',
        target: 'quaint',
      });
      (handlers.get('error') as LogHandler)({
        timestamp: new Date(),
        message: 'an error',
        target: 'quaint',
      });

      expect(logger.warn).toHaveBeenCalledWith('a warning', 'PrismaService');
      expect(logger.error).toHaveBeenCalledWith('an error', 'quaint', 'PrismaService');
    });
  });
});
