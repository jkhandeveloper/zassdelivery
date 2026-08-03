import { registerAs } from '@nestjs/config';

export const DATABASE_CONFIG_KEY = 'database';

export const databaseConfig = registerAs(DATABASE_CONFIG_KEY, () => ({
  url: process.env.DATABASE_URL ?? '',
  /** Queries slower than this are logged at `warn` for index review. */
  slowQueryThresholdMs: Number(process.env.DB_SLOW_QUERY_MS ?? 300),
  /** Emit every query at `debug`. Never enable in production — it leaks parameters. */
  logQueries: process.env.DB_LOG_QUERIES === 'true',
}));
