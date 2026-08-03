import type { NextFunction, Request, Response } from 'express';

import { RequestContext } from '../context/request-context';
import { RequestContextMiddleware } from './request-context.middleware';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function createRequest(headers: Record<string, unknown> = {}): Request {
  return {
    headers,
    ip: '203.0.113.10',
    method: 'GET',
    originalUrl: '/api/v1/users',
  } as unknown as Request;
}

describe('RequestContextMiddleware', () => {
  let middleware: RequestContextMiddleware;
  let response: Response & { setHeader: jest.Mock };

  beforeEach(() => {
    middleware = new RequestContextMiddleware();
    response = { setHeader: jest.fn() } as unknown as Response & { setHeader: jest.Mock };
  });

  it('generates a UUID when the caller supplies no correlation id', () => {
    let observed: string | undefined;
    const next: NextFunction = () => {
      observed = RequestContext.getRequestId();
    };

    middleware.use(createRequest(), response, next);

    expect(observed).toMatch(UUID_PATTERN);
  });

  it('honours an upstream correlation id so a trace spans the call chain', () => {
    let observed: string | undefined;
    const next: NextFunction = () => {
      observed = RequestContext.getRequestId();
    };

    middleware.use(createRequest({ 'x-request-id': 'gateway-trace-1' }), response, next);

    expect(observed).toBe('gateway-trace-1');
  });

  it('uses the first value when the header is repeated', () => {
    let observed: string | undefined;
    const next: NextFunction = () => {
      observed = RequestContext.getRequestId();
    };

    middleware.use(createRequest({ 'x-request-id': ['first', 'second'] }), response, next);

    expect(observed).toBe('first');
  });

  it('falls back to a generated id when the supplied header is blank', () => {
    let observed: string | undefined;
    const next: NextFunction = () => {
      observed = RequestContext.getRequestId();
    };

    middleware.use(createRequest({ 'x-request-id': '   ' }), response, next);

    expect(observed).toMatch(UUID_PATTERN);
  });

  it('echoes the correlation id back on the response', () => {
    middleware.use(createRequest({ 'x-request-id': 'trace-9' }), response, () => {});

    expect(response.setHeader).toHaveBeenCalledWith('x-request-id', 'trace-9');
  });

  it('captures request metadata in the store', () => {
    let store: ReturnType<typeof RequestContext.get>;
    middleware.use(createRequest(), response, () => {
      store = RequestContext.get();
    });

    expect(store).toMatchObject({
      ip: '203.0.113.10',
      method: 'GET',
      path: '/api/v1/users',
    });
    expect(store?.startedAt).toEqual(expect.any(Number));
  });

  it('closes the scope once the request completes', () => {
    middleware.use(createRequest(), response, () => {});

    expect(RequestContext.get()).toBeUndefined();
  });
});
