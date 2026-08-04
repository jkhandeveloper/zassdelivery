import { type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerGuard } from '@nestjs/throttler';

import { jwtConfig } from '@/config';

import { AllExceptionsFilter } from './filters/all-exceptions.filter';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { PermissionsGuard } from './guards/permissions.guard';
import { RolesGuard } from './guards/roles.guard';
import { LoggingInterceptor } from './interceptors/logging.interceptor';
import { ResponseInterceptor } from './interceptors/response.interceptor';
import { TimeoutInterceptor } from './interceptors/timeout.interceptor';
import { RequestContextMiddleware } from './middleware/request-context.middleware';

/**
 * Owns the request pipeline that every endpoint in the application shares:
 * correlation, error rendering, the response envelope, access logging,
 * timeouts and rate limiting.
 *
 * Keeping these registrations here rather than in `AppModule` means the root
 * module only describes *which* features exist, while this module describes
 * *how* every request is handled — so a feature module never has to re-declare
 * any of it.
 */
@Module({
  imports: [ConfigModule.forFeature(jwtConfig), JwtModule.register({})],
  providers: [
    // A single exit point for every failure, including Prisma engine errors.
    { provide: APP_FILTER, useClass: AllExceptionsFilter },

    // Interceptors run outermost-first on the way in: Logging wraps Timeout,
    // which wraps Response. That ordering means the access log records the
    // real duration even when a request is cut short by the timeout.
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
    { provide: APP_INTERCEPTOR, useClass: TimeoutInterceptor },
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },

    // Guards run in registration order. Rate limiting comes first so a flood of
    // unauthenticated requests is rejected before any token is verified, then
    // authentication, then the two authorisation checks — each of which needs
    // the principal the previous guard attached.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class CommonModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Applied to every route so no request can escape correlation.
    consumer.apply(RequestContextMiddleware).forRoutes('*path');
  }
}
