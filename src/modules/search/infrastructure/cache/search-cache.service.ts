import { createHash } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import { RedisService } from '@/infrastructure/redis/redis.service';

/**
 * Cache lifetimes, chosen from how fast each answer actually goes stale.
 *
 * Search results follow the menu, which changes through the day, so they are
 * short-lived. Trending and popular are aggregates over days of orders and
 * barely move minute to minute, so they are held far longer — they are also the
 * most expensive queries in the module.
 */
export const SEARCH_CACHE_TTL = {
  search: 120,
  autocomplete: 300,
  nearby: 60,
  trending: 900,
  popular: 1800,
  categories: 3600,
} as const;

export type SearchCacheKind = keyof typeof SEARCH_CACHE_TTL;

@Injectable()
export class SearchCacheService {
  constructor(private readonly redis: RedisService) {}

  /**
   * Builds a stable cache key from the query parameters.
   *
   * The parameters are sorted and hashed rather than concatenated: a raw search
   * term could contain colons, spaces or newlines that would corrupt the
   * keyspace, and long queries would produce unbounded key lengths.
   */
  buildKey(kind: SearchCacheKind, params: Record<string, unknown>): string {
    const normalised = Object.entries(params)
      .filter(([, value]) => value !== undefined && value !== null && value !== '')
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${String(value)}`)
      .join('&');

    const digest = createHash('sha1').update(normalised).digest('hex').slice(0, 20);

    return `search:${kind}:${digest}`;
  }

  /**
   * Returns the cached value, or computes and stores it.
   *
   * A cache failure must never fail a search: Redis being unavailable degrades
   * this to a direct database read rather than a 500.
   */
  async remember<T>(
    kind: SearchCacheKind,
    params: Record<string, unknown>,
    produce: () => Promise<T>,
  ): Promise<T> {
    const key = this.buildKey(kind, params);

    try {
      const cached = await this.redis.getJson<T>(key);

      if (cached !== null) {
        return cached;
      }
    } catch {
      return produce();
    }

    const fresh = await produce();

    try {
      await this.redis.setJson(key, fresh, SEARCH_CACHE_TTL[kind]);
    } catch {
      // The caller already has its answer; failing to memoise it is not worth
      // surfacing as an error.
    }

    return fresh;
  }

  /** Drops every cached search answer. Called when the catalogue changes. */
  async invalidateAll(): Promise<number> {
    return this.redis.deleteByPattern('search:*');
  }

  async invalidateKind(kind: SearchCacheKind): Promise<number> {
    return this.redis.deleteByPattern(`search:${kind}:*`);
  }
}
