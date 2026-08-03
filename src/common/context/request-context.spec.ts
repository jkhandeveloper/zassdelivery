import { setTimeout as delay } from 'node:timers/promises';

import { RequestContext, type RequestContextStore } from './request-context';

const store = (requestId: string): RequestContextStore => ({
  requestId,
  startedAt: Date.now(),
});

describe('RequestContext', () => {
  it('exposes the store inside a scope', () => {
    RequestContext.run(store('req-1'), () => {
      expect(RequestContext.getRequestId()).toBe('req-1');
    });
  });

  it('returns undefined outside any scope', () => {
    expect(RequestContext.get()).toBeUndefined();
    expect(RequestContext.getRequestId()).toBeUndefined();
  });

  it('survives await boundaries', async () => {
    await RequestContext.run(store('req-async'), async () => {
      await delay(5);
      // The whole point of AsyncLocalStorage: the id must still be present
      // after the continuation resumes on a later tick.
      expect(RequestContext.getRequestId()).toBe('req-async');
    });
  });

  it('isolates concurrent scopes from one another', async () => {
    const observed: string[] = [];

    const task = (id: string, ms: number): Promise<void> =>
      RequestContext.run(store(id), async () => {
        await delay(ms);
        observed.push(RequestContext.getRequestId() ?? 'missing');
      });

    // Interleaved on purpose: 'slow' resumes after 'fast' has finished.
    await Promise.all([task('slow', 20), task('fast', 1)]);

    expect(observed.sort()).toEqual(['fast', 'slow']);
  });

  it('patches fields onto the active store', () => {
    RequestContext.run(store('req-2'), () => {
      RequestContext.patch({ userId: 'usr_9', role: 'CUSTOMER' });

      expect(RequestContext.getUserId()).toBe('usr_9');
      expect(RequestContext.get()?.role).toBe('CUSTOMER');
    });
  });

  it('ignores a patch outside a scope instead of throwing', () => {
    // Background jobs and cron tasks run with no request scope; they must not
    // crash simply because something tried to annotate the context.
    expect(() => RequestContext.patch({ userId: 'usr_1' })).not.toThrow();
  });

  it('reports elapsed time within a scope', async () => {
    await RequestContext.run(store('req-3'), async () => {
      await delay(10);
      expect(RequestContext.elapsedMs()).toBeGreaterThanOrEqual(9);
    });
  });
});
