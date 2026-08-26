import {
  type CallHandler,
  type ExecutionContext,
  Inject,
  Injectable,
  type NestInterceptor,
  RequestTimeoutException,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { catchError, throwError, timeout, TimeoutError, type Observable } from 'rxjs';

import { appConfig } from '@/config';

import { REQUEST_TIMEOUT_KEY } from '../decorators/request-timeout.decorator';

/**
 * Caps how long any single request may occupy a worker.
 *
 * Without this, one slow downstream dependency can exhaust the event loop's
 * useful capacity and take the whole API down with it.
 */
@Injectable()
export class TimeoutInterceptor implements NestInterceptor {
  constructor(
    @Inject(appConfig.KEY)
    private readonly config: ConfigType<typeof appConfig>,
    private readonly reflector: Reflector,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const limit =
      this.reflector.getAllAndOverride<number>(REQUEST_TIMEOUT_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? this.config.requestTimeoutMs;

    return next.handle().pipe(
      timeout(limit),
      catchError((error: unknown) => {
        if (error instanceof TimeoutError) {
          return throwError(
            () => new RequestTimeoutException(`The request exceeded the ${limit}ms time limit.`),
          );
        }
        return throwError(() => error);
      }),
    );
  }
}
