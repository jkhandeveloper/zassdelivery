import { type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard } from '@nestjs/throttler';

import { AllExceptionsFilter } from './filters/all-exceptions.filter';
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
  providers: [
    // A single exit point for every failure, including Prisma engine errors.
    { provide: APP_FILTER, useClass: AllExceptionsFilter },

    // Interceptors run outermost-first on the way in: Logging wraps Timeout,
    // which wraps Response. That ordering means the access log records the
    // real duration even when a request is cut short by the timeout.
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
    { provide: APP_INTERCEPTOR, useClass: TimeoutInterceptor },
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },

    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class CommonModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Applied to every route so no request can escape correlation.
    consumer.apply(RequestContextMiddleware).forRoutes('*path');
  }
}
