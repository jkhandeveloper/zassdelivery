import { AsyncLocalStorage } from 'node:async_hooks';

/** Ambient data carried alongside a single inbound request. */
export interface RequestContextStore {
  /** Correlation id echoed back to the caller as `x-request-id`. */
  requestId: string;
  userId?: string;
  role?: string;
  ip?: string;
  method?: string;
  path?: string;
  /** `Date.now()` at the moment the request entered the pipeline. */
  startedAt: number;
}

/**
 * Request-scoped ambient context backed by `AsyncLocalStorage`.
 *
 * This lets the logger stamp every line with a correlation id without
 * threading a context object through every service signature, and without
 * making providers request-scoped (which would defeat Nest's singleton DI
 * and measurably slow the container down).
 */
export class RequestContext {
  private static readonly storage = new AsyncLocalStorage<RequestContextStore>();

  /** Runs `callback` with `store` bound to the current async execution path. */
  static run<T>(store: RequestContextStore, callback: () => T): T {
    return this.storage.run(store, callback);
  }

  /** The active store, or `undefined` outside a request (e.g. a cron job). */
  static get(): RequestContextStore | undefined {
    return this.storage.getStore();
  }

  static getRequestId(): string | undefined {
    return this.storage.getStore()?.requestId;
  }

  static getUserId(): string | undefined {
    return this.storage.getStore()?.userId;
  }

  /**
   * Merges fields into the active store. Used by the auth guard to attach the
   * authenticated principal once the token has been verified. No-ops outside
   * a request rather than throwing, so background work stays safe.
   */
  static patch(fields: Partial<RequestContextStore>): void {
    const store = this.storage.getStore();
    if (!store) {
      return;
    }
    Object.assign(store, fields);
  }

  /** Milliseconds elapsed since the request entered the pipeline. */
  static elapsedMs(): number | undefined {
    const store = this.storage.getStore();
    return store ? Date.now() - store.startedAt : undefined;
  }
}
