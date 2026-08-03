import {
  type CallHandler,
  type ExecutionContext,
  Inject,
  Injectable,
  type NestInterceptor,
  RequestTimeoutException,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { catchError, throwError, timeout, TimeoutError, type Observable } from 'rxjs';

import { appConfig } from '@/config';

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
  ) {}

  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      timeout(this.config.requestTimeoutMs),
      catchError((error: unknown) => {
        if (error instanceof TimeoutError) {
          return throwError(
            () =>
              new RequestTimeoutException(
                `The request exceeded the ${this.config.requestTimeoutMs}ms time limit.`,
              ),
          );
        }
        return throwError(() => error);
      }),
    );
  }
}
