import { registerAs } from '@nestjs/config';

import { LogLevel, NodeEnv } from './env.validation';

export const LOGGER_CONFIG_KEY = 'logger';

export const loggerConfig = registerAs(LOGGER_CONFIG_KEY, () => {
  const nodeEnv = (process.env.NODE_ENV ?? NodeEnv.Development) as NodeEnv;

  return {
    level: (process.env.LOG_LEVEL ?? LogLevel.Info) as LogLevel,
    /**
     * Structured JSON in production so log shippers can parse it; colourised
     * human-readable output locally. Logs always go to stdout — container
     * runtimes own collection and rotation (12-factor).
     */
    prettyPrint: nodeEnv !== NodeEnv.Production,
    silent: nodeEnv === NodeEnv.Test,
    serviceName: 'zassdelivery-api',
    /** Request bodies and headers matching these keys are masked before logging. */
    redactKeys: [
      'password',
      'passwordHash',
      'otp',
      'code',
      'token',
      'accessToken',
      'refreshToken',
      'authorization',
      'cookie',
    ],
  };
});
