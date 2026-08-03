import { Test } from '@nestjs/testing';
import { HealthIndicatorService } from '@nestjs/terminus';

import { PrismaService } from '@/infrastructure/prisma/prisma.service';

import { PrismaHealthIndicator } from './prisma.health-indicator';

describe('PrismaHealthIndicator', () => {
  let indicator: PrismaHealthIndicator;
  let prisma: { healthCheck: jest.Mock };

  beforeEach(async () => {
    prisma = { healthCheck: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        PrismaHealthIndicator,
        HealthIndicatorService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    indicator = moduleRef.get(PrismaHealthIndicator);
  });

  it('reports "up" when the database responds', async () => {
    prisma.healthCheck.mockResolvedValue(true);

    const result = await indicator.isHealthy('database');

    expect(result.database?.status).toBe('up');
    expect(result.database?.responseTimeMs).toEqual(expect.any(Number));
  });

  it('reports "down" instead of throwing when the database is unreachable', async () => {
    prisma.healthCheck.mockRejectedValue(new Error('ECONNREFUSED'));

    // The readiness probe must return a 503 body, not blow up the handler.
    const result = await indicator.isHealthy('database');

    expect(result.database?.status).toBe('down');
    expect(result.database?.message).toBe('ECONNREFUSED');
  });

  it('handles a non-Error rejection', async () => {
    prisma.healthCheck.mockRejectedValue('some string failure');

    const result = await indicator.isHealthy('database');

    expect(result.database?.status).toBe('down');
    expect(result.database?.message).toBe('Database unreachable');
  });
});
