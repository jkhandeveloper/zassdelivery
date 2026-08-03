import { registerAs } from '@nestjs/config';

export const REDIS_CONFIG_KEY = 'redis';

export const redisConfig = registerAs(REDIS_CONFIG_KEY, () => ({
  host: process.env.REDIS_HOST ?? 'localhost',
  port: Number(process.env.REDIS_PORT ?? 6379),
  /** Empty string means "no auth", which is the local Compose default. */
  password: process.env.REDIS_PASSWORD?.length ? process.env.REDIS_PASSWORD : undefined,
  db: Number(process.env.REDIS_DB ?? 0),
  keyPrefix: process.env.REDIS_KEY_PREFIX ?? 'zass:',
  /** Commands fail fast instead of queueing forever when Redis is unreachable. */
  connectTimeoutMs: 10000,
  commandTimeoutMs: 5000,
  maxRetriesPerRequest: 3,
}));
