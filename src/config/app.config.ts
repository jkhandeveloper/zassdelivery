import { registerAs } from '@nestjs/config';

import { NodeEnv } from './env.validation';

export const APP_CONFIG_KEY = 'app';

/**
 * Application-level settings. Injected type-safely via
 * `@Inject(appConfig.KEY) cfg: ConfigType<typeof appConfig>`.
 */
export const appConfig = registerAs(APP_CONFIG_KEY, () => {
  const nodeEnv = (process.env.NODE_ENV ?? NodeEnv.Development) as NodeEnv;
  const rawOrigins = process.env.CORS_ORIGINS ?? '*';

  return {
    nodeEnv,
    isProduction: nodeEnv === NodeEnv.Production,
    isTest: nodeEnv === NodeEnv.Test,
    port: Number(process.env.PORT ?? 3000),
    apiPrefix: process.env.API_PREFIX ?? 'api',
    apiVersion: process.env.API_VERSION ?? '1',
    corsOrigins:
      rawOrigins.trim() === '*'
        ? true
        : rawOrigins
            .split(',')
            .map((origin) => origin.trim())
            .filter((origin) => origin.length > 0),
    countryCode: process.env.DEFAULT_COUNTRY_CODE ?? '+92',
    timezone: process.env.DEFAULT_TIMEZONE ?? 'Asia/Karachi',
    currency: process.env.DEFAULT_CURRENCY ?? 'PKR',
    /** Requests are aborted after this many milliseconds by the timeout interceptor. */
    requestTimeoutMs: 15000,
    /** Grace period given to in-flight requests during shutdown. */
    shutdownTimeoutMs: 10000,
  };
});
