import { appConfig } from './app.config';
import { databaseConfig } from './database.config';
import { jwtConfig } from './jwt.config';
import { loggerConfig } from './logger.config';
import { redisConfig } from './redis.config';
import { swaggerConfig } from './swagger.config';
import { throttleConfig } from './throttle.config';

export * from './app.config';
export * from './database.config';
export * from './env.validation';
export * from './jwt.config';
export * from './logger.config';
export * from './redis.config';
export * from './swagger.config';
export * from './throttle.config';

/** Every namespace loaded by `ConfigModule.forRoot({ load: configurations })`. */
export const configurations = [
  appConfig,
  databaseConfig,
  redisConfig,
  jwtConfig,
  loggerConfig,
  throttleConfig,
  swaggerConfig,
];
