import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Response } from 'express';
import { map, type Observable } from 'rxjs';

import { RequestContext } from '../context/request-context';
import { SKIP_RESPONSE_WRAP_KEY } from '../decorators/skip-response-wrap.decorator';
import { isPaginatedResult, type PaginationMeta } from '../interfaces/paginated-result.interface';

interface SuccessEnvelope<T> {
  success: true;
  statusCode: number;
  message: string;
  data: T;
  meta?: PaginationMeta;
  requestId: string;
  timestamp: string;
}

/**
 * Wraps every successful handler result in the standard envelope so clients
 * parse one shape across the entire API.
 *
 * A `PaginatedResult` is unpacked automatically: `items` becomes `data` and
 * the pagination block is hoisted to `meta`, which keeps controllers free of
 * presentation concerns.
 */
@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<T, SuccessEnvelope<T> | T> {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler<T>): Observable<SuccessEnvelope<T> | T> {
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_RESPONSE_WRAP_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (skip === true) {
      return next.handle();
    }

    const response = context.switchToHttp().getResponse<Response>();

    return next.handle().pipe(
      map((payload): SuccessEnvelope<T> => {
        const base = {
          success: true as const,
          statusCode: response.statusCode,
          message: 'OK',
          requestId: RequestContext.getRequestId() ?? 'unknown',
          timestamp: new Date().toISOString(),
        };

        if (isPaginatedResult(payload)) {
          return {
            ...base,
            data: payload.items as T,
            meta: payload.meta,
          };
        }

        return { ...base, data: payload };
      }),
    );
  }
}
