import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';

import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { RedisService } from '@/infrastructure/redis/redis.service';

import { createTestApp } from './utils/create-test-app';

describe('Health (e2e)', () => {
  let app: INestApplication;
  let server: App;

  beforeAll(async () => {
    app = await createTestApp();
    server = app.getHttpServer() as App;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /api/v1/health/live', () => {
    it('returns 200 with uptime', async () => {
      const response = await request(server).get('/api/v1/health/live').expect(200);

      expect(response.body).toMatchObject({ status: 'ok' });
      expect(response.body.uptimeSeconds).toEqual(expect.any(Number));
    });

    it('is not wrapped in the success envelope', async () => {
      // Orchestrators expect the probe's own shape, so this route opts out.
      const response = await request(server).get('/api/v1/health/live').expect(200);

      expect(response.body.success).toBeUndefined();
      expect(response.body.data).toBeUndefined();
    });
  });

  describe('GET /api/v1/health/ready', () => {
    it('reports the database and redis as up', async () => {
      const response = await request(server).get('/api/v1/health/ready').expect(200);

      expect(response.body.status).toBe('ok');
      expect(response.body.info.database.status).toBe('up');
      expect(response.body.info.redis.status).toBe('up');
    });
  });

  describe('GET /api/v1/health', () => {
    it('includes the memory heap check alongside the dependencies', async () => {
      const response = await request(server).get('/api/v1/health').expect(200);

      expect(Object.keys(response.body.info as Record<string, unknown>).sort()).toEqual([
        'database',
        'memory_heap',
        'redis',
      ]);
    });

    it('returns 503 when a dependency is unreachable', async () => {
      const prisma = app.get(PrismaService);
      const spy = jest
        .spyOn(prisma, 'healthCheck')
        .mockRejectedValue(new Error('connection refused'));

      const response = await request(server).get('/api/v1/health').expect(503);

      expect(response.body.status).toBe('error');
      expect(response.body.error.database.status).toBe('down');

      spy.mockRestore();
    });
  });

  describe('infrastructure wiring', () => {
    it('has a live Redis connection', async () => {
      await expect(app.get(RedisService).ping()).resolves.toBe(true);
    });

    it('echoes a supplied correlation id back to the caller', async () => {
      const response = await request(server)
        .get('/api/v1/health/live')
        .set('x-request-id', 'e2e-trace-001')
        .expect(200);

      expect(response.headers['x-request-id']).toBe('e2e-trace-001');
    });

    it('generates a correlation id when the caller supplies none', async () => {
      const response = await request(server).get('/api/v1/health/live').expect(200);

      expect(response.headers['x-request-id']).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
    });
  });

  describe('error handling', () => {
    it('returns the standard error envelope for an unknown route', async () => {
      const response = await request(server).get('/api/v1/does-not-exist').expect(404);

      expect(response.body).toMatchObject({
        success: false,
        statusCode: 404,
        path: '/api/v1/does-not-exist',
      });
      expect(response.body.requestId).toEqual(expect.any(String));
      expect(response.body.timestamp).toEqual(expect.any(String));
    });
  });
});
