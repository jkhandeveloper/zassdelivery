import { Controller, Get, UseFilters } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  HealthCheck,
  HealthCheckService,
  MemoryHealthIndicator,
  type HealthCheckResult,
} from '@nestjs/terminus';
import { SkipThrottle } from '@nestjs/throttler';

import { SkipResponseWrap } from '@/common/decorators/skip-response-wrap.decorator';

import { HealthCheckExceptionFilter } from './health-exception.filter';
import { PrismaHealthIndicator } from './indicators/prisma.health-indicator';
import { RedisHealthIndicator } from './indicators/redis.health-indicator';

/**
 * Probes are exempt from the response envelope and from rate limiting:
 * orchestrators poll them frequently and expect Terminus' native shape — on
 * success via `@SkipResponseWrap`, and on failure via the filter below.
 */
@ApiTags('Health')
@Controller('health')
@SkipThrottle()
@SkipResponseWrap()
@UseFilters(HealthCheckExceptionFilter)
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly prismaIndicator: PrismaHealthIndicator,
    private readonly redisIndicator: RedisHealthIndicator,
    private readonly memory: MemoryHealthIndicator,
  ) {}

  @Get()
  @HealthCheck()
  @ApiOperation({
    summary: 'Full health check',
    description: 'Verifies PostgreSQL, Redis and process memory headroom.',
  })
  @ApiResponse({ status: 200, description: 'All dependencies are healthy.' })
  @ApiResponse({ status: 503, description: 'At least one dependency is unhealthy.' })
  check(): Promise<HealthCheckResult> {
    return this.health.check([
      () => this.prismaIndicator.isHealthy('database'),
      () => this.redisIndicator.isHealthy('redis'),
      // Flags runaway heap growth before the process is OOM-killed.
      () => this.memory.checkHeap('memory_heap', 512 * 1024 * 1024),
    ]);
  }

  @Get('live')
  @ApiOperation({
    summary: 'Liveness probe',
    description:
      'Returns 200 whenever the process is running. Deliberately checks no ' +
      'dependencies — a database outage must not cause the orchestrator to ' +
      'restart otherwise-healthy containers.',
  })
  @ApiResponse({ status: 200, description: 'Process is alive.' })
  live(): { status: string; uptimeSeconds: number; timestamp: string } {
    return {
      status: 'ok',
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }

  @Get('ready')
  @HealthCheck()
  @ApiOperation({
    summary: 'Readiness probe',
    description:
      'Returns 200 only when every backing service is reachable, so traffic ' +
      'is routed to this instance solely when it can actually serve requests.',
  })
  @ApiResponse({ status: 200, description: 'Ready to receive traffic.' })
  @ApiResponse({ status: 503, description: 'Not ready.' })
  ready(): Promise<HealthCheckResult> {
    return this.health.check([
      () => this.prismaIndicator.isHealthy('database'),
      () => this.redisIndicator.isHealthy('redis'),
    ]);
  }
}
