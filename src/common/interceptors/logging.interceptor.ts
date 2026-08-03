import {
  type CallHandler,
  type ExecutionContext,
  Inject,
  Injectable,
  type LoggerService,
  type NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { tap, type Observable } from 'rxjs';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';

import { RequestContext } from '../context/request-context';

/**
 * Emits one structured access-log line per completed request.
 *
 * Failures are intentionally not logged here — `AllExceptionsFilter` owns that
 * and has the normalised status code, so logging both would double-report.
 */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly context = 'HTTP';

  constructor(
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: LoggerService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    const startedAt = Date.now();

    return next.handle().pipe(
      tap({
        next: () => {
          const durationMs = Date.now() - startedAt;
          this.logger.log?.(
            `${request.method} ${request.originalUrl} ${response.statusCode} — ${durationMs}ms`,
            this.context,
          );
        },
        error: () => {
          // Swallowed on purpose: the exception filter records the failure.
          RequestContext.patch({});
        },
      }),
    );
  }
}
