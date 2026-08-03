import {
  Inject,
  Injectable,
  type LoggerService,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { Prisma, PrismaClient } from '@prisma/client';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';

import { databaseConfig } from '@/config';

/**
 * The single PrismaClient instance for the process.
 *
 * The second type parameter declares which log levels are emitted as events,
 * which is what gives `$on('query', …)` its precise callback typing.
 */
@Injectable()
export class PrismaService
  extends PrismaClient<Prisma.PrismaClientOptions, 'query' | 'warn' | 'error'>
  implements OnModuleInit, OnModuleDestroy
{
  private readonly context = PrismaService.name;

  constructor(
    @Inject(databaseConfig.KEY)
    private readonly config: ConfigType<typeof databaseConfig>,
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: LoggerService,
  ) {
    super({
      datasources: { db: { url: config.url } },
      log: [
        { emit: 'event', level: 'query' },
        { emit: 'event', level: 'warn' },
        { emit: 'event', level: 'error' },
      ],
      errorFormat: 'minimal',
    });
  }

  async onModuleInit(): Promise<void> {
    this.registerLogForwarding();
    await this.$connect();
    this.logger.log?.('Database connection established', this.context);
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
    this.logger.log?.('Database connection closed', this.context);
  }

  /**
   * Lightweight probe for the readiness endpoint. `SELECT 1` round-trips the
   * connection without touching application tables.
   */
  async healthCheck(): Promise<boolean> {
    await this.$queryRaw`SELECT 1`;
    return true;
  }

  /**
   * Truncates every application table. Restricted to non-production
   * environments and used only by the end-to-end test harness.
   */
  async truncateAll(): Promise<void> {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('truncateAll() is disabled in production');
    }

    const tables = await this.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename NOT LIKE '_prisma%'
    `;

    if (tables.length === 0) {
      return;
    }

    const quoted = tables.map(({ tablename }) => `"public"."${tablename}"`).join(', ');
    await this.$executeRawUnsafe(`TRUNCATE TABLE ${quoted} RESTART IDENTITY CASCADE`);
  }

  /**
   * Pipes Prisma's engine events into Winston so database activity lands in the
   * same correlated stream as application logs.
   */
  private registerLogForwarding(): void {
    this.$on('warn', (event: Prisma.LogEvent) => {
      this.logger.warn?.(event.message, this.context);
    });

    this.$on('error', (event: Prisma.LogEvent) => {
      this.logger.error?.(event.message, event.target, this.context);
    });

    this.$on('query', (event: Prisma.QueryEvent) => {
      if (event.duration >= this.config.slowQueryThresholdMs) {
        this.logger.warn?.(`Slow query (${event.duration}ms): ${event.query}`, this.context);
        return;
      }

      if (this.config.logQueries) {
        this.logger.debug?.(`${event.query} — ${event.duration}ms`, this.context);
      }
    });
  }
}
