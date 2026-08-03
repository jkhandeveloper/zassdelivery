import { Test } from '@nestjs/testing';
import { HealthIndicatorService } from '@nestjs/terminus';

import { RedisService } from '@/infrastructure/redis/redis.service';

import { RedisHealthIndicator } from './redis.health-indicator';

describe('RedisHealthIndicator', () => {
  let indicator: RedisHealthIndicator;
  let redis: { ping: jest.Mock };

  beforeEach(async () => {
    redis = { ping: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        RedisHealthIndicator,
        HealthIndicatorService,
        { provide: RedisService, useValue: redis },
      ],
    }).compile();

    indicator = moduleRef.get(RedisHealthIndicator);
  });

  it('reports "up" when PING succeeds', async () => {
    redis.ping.mockResolvedValue(true);

    const result = await indicator.isHealthy('redis');

    expect(result.redis?.status).toBe('up');
    expect(result.redis?.responseTimeMs).toEqual(expect.any(Number));
  });

  it('reports "down" on an unexpected PING reply', async () => {
    redis.ping.mockResolvedValue(false);

    const result = await indicator.isHealthy('redis');

    expect(result.redis?.status).toBe('down');
    expect(result.redis?.message).toBe('Unexpected PING reply');
  });

  it('reports "down" instead of throwing when Redis is unreachable', async () => {
    redis.ping.mockRejectedValue(new Error('ECONNREFUSED'));

    const result = await indicator.isHealthy('redis');

    expect(result.redis?.status).toBe('down');
    expect(result.redis?.message).toBe('ECONNREFUSED');
  });

  it('handles a non-Error rejection', async () => {
    redis.ping.mockRejectedValue('boom');

    const result = await indicator.isHealthy('redis');

    expect(result.redis?.status).toBe('down');
    expect(result.redis?.message).toBe('Redis unreachable');
  });
});
