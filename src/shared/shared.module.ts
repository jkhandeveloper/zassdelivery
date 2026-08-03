import { Global, Module } from '@nestjs/common';

import { LoggerModule } from '@/infrastructure/logger/logger.module';
import { PrismaModule } from '@/infrastructure/prisma/prisma.module';
import { RedisModule } from '@/infrastructure/redis/redis.module';

/**
 * Aggregates the infrastructure a feature module needs to talk to the outside
 * world: the database, the cache and the logger.
 *
 * Feature modules import this one module instead of naming each provider
 * individually, so adding a new shared backing service later is a change in one
 * place rather than in every module that needs it.
 *
 * `PrismaModule` is the database module — the name reflects the driver in use,
 * and swapping it out would be a change confined to this file.
 */
@Global()
@Module({
  imports: [LoggerModule, PrismaModule, RedisModule],
  exports: [LoggerModule, PrismaModule, RedisModule],
})
export class SharedModule {}
