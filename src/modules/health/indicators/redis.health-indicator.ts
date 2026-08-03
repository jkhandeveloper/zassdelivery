import { Injectable } from '@nestjs/common';
import { HealthIndicatorService, type HealthIndicatorResult } from '@nestjs/terminus';

import { RedisService } from '@/infrastructure/redis/redis.service';

/** Reports Redis reachability via PING. */
@Injectable()
export class RedisHealthIndicator {
  constructor(
    private readonly healthIndicatorService: HealthIndicatorService,
    private readonly redis: RedisService,
  ) {}

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const indicator = this.healthIndicatorService.check(key);
    const startedAt = Date.now();

    try {
      const alive = await this.redis.ping();
      return alive
        ? indicator.up({ responseTimeMs: Date.now() - startedAt })
        : indicator.down({ message: 'Unexpected PING reply' });
    } catch (error) {
      return indicator.down({
        message: error instanceof Error ? error.message : 'Redis unreachable',
        responseTimeMs: Date.now() - startedAt,
      });
    }
  }
}
