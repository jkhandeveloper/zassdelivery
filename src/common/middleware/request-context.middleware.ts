import { randomUUID } from 'node:crypto';

import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

import { REQUEST_ID_HEADER } from '../constants/app.constants';
import { RequestContext, type RequestContextStore } from '../context/request-context';

/**
 * Opens an `AsyncLocalStorage` scope for every request and assigns a
 * correlation id. An upstream id (from a gateway or a mobile client) is
 * honoured when present so a single trace spans the whole call chain.
 */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const incoming = req.headers[REQUEST_ID_HEADER];
    const requestId = (Array.isArray(incoming) ? incoming[0] : incoming)?.trim() || randomUUID();

    const store: RequestContextStore = {
      requestId,
      ip: req.ip,
      method: req.method,
      path: req.originalUrl,
      startedAt: Date.now(),
    };

    // Echo the id back so clients can quote it in bug reports.
    res.setHeader(REQUEST_ID_HEADER, requestId);

    RequestContext.run(store, () => {
      next();
    });
  }
}
