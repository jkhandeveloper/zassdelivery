import {
  Inject,
  Injectable,
  type LoggerService,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import Redis from 'ioredis';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';

import { redisConfig } from '@/config';

/**
 * Thin, typed wrapper over a single ioredis connection.
 *
 * Feature modules depend on this service rather than on ioredis directly, so
 * the cache backend stays swappable and every call site gets JSON handling and
 * consistent error semantics for free.
 */
@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly context = RedisService.name;
  private readonly client: Redis;

  constructor(
    @Inject(redisConfig.KEY)
    private readonly config: ConfigType<typeof redisConfig>,
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: LoggerService,
  ) {
    this.client = new Redis({
      host: config.host,
      port: config.port,
      password: config.password,
      db: config.db,
      keyPrefix: config.keyPrefix,
      connectTimeout: config.connectTimeoutMs,
      commandTimeout: config.commandTimeoutMs,
      maxRetriesPerRequest: config.maxRetriesPerRequest,
      enableReadyCheck: true,
      // Connect explicitly in onModuleInit so a bad Redis fails the boot
      // rather than surfacing on the first cache read.
      lazyConnect: true,
      retryStrategy: (attempt: number) => Math.min(attempt * 200, 3000),
    });

    this.client.on('error', (error: Error) => {
      this.logger.error?.(`Redis error: ${error.message}`, error.stack, this.context);
    });

    this.client.on('reconnecting', () => {
      this.logger.warn?.('Redis reconnecting…', this.context);
    });
  }

  async onModuleInit(): Promise<void> {
    await this.client.connect();
    this.logger.log?.(`Redis connected at ${this.config.host}:${this.config.port}`, this.context);
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit();
    this.logger.log?.('Redis connection closed', this.context);
  }

  /** Escape hatch for advanced commands (pipelines, pub/sub, Lua scripts). */
  getClient(): Redis {
    return this.client;
  }

  async ping(): Promise<boolean> {
    const reply = await this.client.ping();
    return reply === 'PONG';
  }

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  /** Stores a value, optionally with a TTL expressed in seconds. */
  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (ttlSeconds !== undefined && ttlSeconds > 0) {
      await this.client.set(key, value, 'EX', ttlSeconds);
      return;
    }
    await this.client.set(key, value);
  }

  /**
   * Sets a key only when it does not already exist.
   * Returns `true` when this call created the key — the primitive behind
   * distributed locks and OTP resend cooldowns.
   */
  async setIfAbsent(key: string, value: string, ttlSeconds: number): Promise<boolean> {
    const reply = await this.client.set(key, value, 'EX', ttlSeconds, 'NX');
    return reply === 'OK';
  }

  async getJson<T>(key: string): Promise<T | null> {
    const raw = await this.client.get(key);
    if (raw === null) {
      return null;
    }

    try {
      return JSON.parse(raw) as T;
    } catch {
      // A poisoned entry must not break the caller; drop it and miss the cache.
      this.logger.warn?.(`Discarding malformed JSON at key "${key}"`, this.context);
      await this.client.del(key);
      return null;
    }
  }

  async setJson<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    await this.set(key, JSON.stringify(value), ttlSeconds);
  }

  async delete(...keys: string[]): Promise<number> {
    if (keys.length === 0) {
      return 0;
    }
    return this.client.del(...keys);
  }

  async exists(key: string): Promise<boolean> {
    return (await this.client.exists(key)) === 1;
  }

  /** Atomic counter used for rate limits and OTP attempt tracking. */
  async increment(key: string, ttlSeconds?: number): Promise<number> {
    const value = await this.client.incr(key);
    // Only arm the TTL on creation, so the window does not slide on every hit.
    if (value === 1 && ttlSeconds !== undefined && ttlSeconds > 0) {
      await this.client.expire(key, ttlSeconds);
    }
    return value;
  }

  /** Remaining lifetime in seconds; `-1` when the key has no TTL, `-2` when absent. */
  async ttl(key: string): Promise<number> {
    return this.client.ttl(key);
  }

  /**
   * Deletes every key matching `pattern`, using SCAN rather than KEYS so a
   * large keyspace is never blocked.
   *
   * `pattern` is relative to the configured key prefix.
   */
  async deleteByPattern(pattern: string): Promise<number> {
    const prefixed = `${this.config.keyPrefix}${pattern}`;
    let cursor = '0';
    let removed = 0;

    do {
      const [nextCursor, keys] = await this.client.scan(cursor, 'MATCH', prefixed, 'COUNT', 200);
      cursor = nextCursor;

      if (keys.length > 0) {
        // SCAN returns fully-qualified keys while the client re-applies the
        // prefix on write commands, so strip it before deleting.
        const unprefixed = keys.map((key) => key.slice(this.config.keyPrefix.length));
        removed += await this.client.del(...unprefixed);
      }
    } while (cursor !== '0');

    return removed;
  }
}
