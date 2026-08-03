import { Test } from '@nestjs/testing';
import { HealthCheckService, MemoryHealthIndicator } from '@nestjs/terminus';

import { HealthController } from './health.controller';
import { PrismaHealthIndicator } from './indicators/prisma.health-indicator';
import { RedisHealthIndicator } from './indicators/redis.health-indicator';

describe('HealthController', () => {
  let controller: HealthController;
  let healthCheck: jest.Mock;

  beforeEach(async () => {
    healthCheck = jest.fn().mockResolvedValue({ status: 'ok' });

    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: HealthCheckService, useValue: { check: healthCheck } },
        { provide: PrismaHealthIndicator, useValue: { isHealthy: jest.fn() } },
        { provide: RedisHealthIndicator, useValue: { isHealthy: jest.fn() } },
        { provide: MemoryHealthIndicator, useValue: { checkHeap: jest.fn() } },
      ],
    }).compile();

    controller = moduleRef.get(HealthController);
  });

  describe('live', () => {
    it('reports uptime without touching any dependency', () => {
      const result = controller.live();

      expect(result.status).toBe('ok');
      expect(result.uptimeSeconds).toEqual(expect.any(Number));
      // Liveness must never consult the database: a DB outage would otherwise
      // make the orchestrator restart healthy containers in a loop.
      expect(healthCheck).not.toHaveBeenCalled();
    });
  });

  describe('ready', () => {
    it('checks the database and redis only', async () => {
      await controller.ready();

      const checks = healthCheck.mock.calls[0]?.[0] as unknown[];
      expect(checks).toHaveLength(2);
    });
  });

  describe('check', () => {
    it('checks the database, redis and memory heap', async () => {
      await controller.check();

      const checks = healthCheck.mock.calls[0]?.[0] as unknown[];
      expect(checks).toHaveLength(3);
    });
  });
});
