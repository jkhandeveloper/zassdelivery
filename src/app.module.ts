import { Module } from '@nestjs/common';
import { ConfigModule, type ConfigType } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';

import { CommonModule } from './common/common.module';
import { configurations, throttleConfig, validateEnvironment } from './config';
import { AuthModule } from './modules/auth/auth.module';
import { HealthModule } from './modules/health/health.module';
import { UsersModule } from './modules/users/users.module';
import { SharedModule } from './shared/shared.module';

/**
 * The root module names what the application is made of; it deliberately holds
 * no pipeline wiring of its own. Cross-cutting request handling lives in
 * `CommonModule`, and backing infrastructure in `SharedModule`.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      load: configurations,
      // Aborts the boot on a malformed environment instead of failing later
      // with a confusing runtime error.
      validate: validateEnvironment,
      envFilePath: ['.env'],
    }),

    ThrottlerModule.forRootAsync({
      imports: [ConfigModule.forFeature(throttleConfig)],
      inject: [throttleConfig.KEY],
      useFactory: (config: ConfigType<typeof throttleConfig>) => ({
        throttlers: [{ ttl: config.ttl, limit: config.limit }],
      }),
    }),

    // Infrastructure: database, cache, logger.
    SharedModule,

    // Global request pipeline: filters, interceptors, guards, middleware.
    CommonModule,

    // Features
    AuthModule,
    UsersModule,
    HealthModule,
  ],
})
export class AppModule {}
