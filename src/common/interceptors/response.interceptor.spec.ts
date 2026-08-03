import { type CallHandler, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { firstValueFrom, of } from 'rxjs';

import { RequestContext } from '../context/request-context';
import { ResponseInterceptor } from './response.interceptor';

function createContext(statusCode = 200): ExecutionContext {
  return {
    switchToHttp: () => ({
      getResponse: () => ({ statusCode }),
      getRequest: () => ({}),
    }),
    getHandler: () => function handler() {},
    getClass: () => class Controller {},
  } as unknown as ExecutionContext;
}

const handlerReturning = (value: unknown): CallHandler =>
  ({ handle: () => of(value) }) as CallHandler;

describe('ResponseInterceptor', () => {
  let reflector: Reflector;
  let interceptor: ResponseInterceptor<unknown>;

  beforeEach(() => {
    reflector = new Reflector();
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    interceptor = new ResponseInterceptor(reflector);
  });

  it('wraps a plain payload in the success envelope', async () => {
    const result = await firstValueFrom(
      interceptor.intercept(createContext(200), handlerReturning({ id: 'abc' })),
    );

    expect(result).toMatchObject({
      success: true,
      statusCode: 200,
      message: 'OK',
      data: { id: 'abc' },
    });
  });

  it('reflects the handler status code, such as 201 on create', async () => {
    const result = (await firstValueFrom(
      interceptor.intercept(createContext(201), handlerReturning({ id: 'new' })),
    )) as { statusCode: number };

    expect(result.statusCode).toBe(201);
  });

  it('hoists pagination metadata and unwraps items into data', async () => {
    const paginated = {
      items: [{ id: 1 }, { id: 2 }],
      meta: {
        total: 2,
        page: 1,
        limit: 20,
        totalPages: 1,
        hasPreviousPage: false,
        hasNextPage: false,
      },
    };

    const result = (await firstValueFrom(
      interceptor.intercept(createContext(), handlerReturning(paginated)),
    )) as { data: unknown; meta: unknown };

    expect(result.data).toEqual(paginated.items);
    expect(result.meta).toEqual(paginated.meta);
  });

  it('does not mistake a plain object with an items array for a paginated result', async () => {
    const payload = { items: ['a'], somethingElse: true };

    const result = (await firstValueFrom(
      interceptor.intercept(createContext(), handlerReturning(payload)),
    )) as { data: unknown; meta?: unknown };

    expect(result.data).toEqual(payload);
    expect(result.meta).toBeUndefined();
  });

  it('includes the ambient request id when inside a request scope', async () => {
    const result = await RequestContext.run({ requestId: 'req-123', startedAt: Date.now() }, () =>
      firstValueFrom(interceptor.intercept(createContext(), handlerReturning({ ok: true }))),
    );

    expect((result as { requestId: string }).requestId).toBe('req-123');
  });

  it('returns the raw payload when the handler opts out of wrapping', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);

    const payload = { status: 'ok' };
    const result = await firstValueFrom(
      interceptor.intercept(createContext(), handlerReturning(payload)),
    );

    expect(result).toBe(payload);
  });

  it('preserves null payloads rather than dropping the data key', async () => {
    const result = (await firstValueFrom(
      interceptor.intercept(createContext(), handlerReturning(null)),
    )) as { data: unknown };

    expect(result.data).toBeNull();
  });
});
