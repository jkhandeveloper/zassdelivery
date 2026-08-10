import { generateKeyPairSync } from 'node:crypto';

import type { LoggerService } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';

import type { notificationsConfig } from '@/config';

import { FcmSender } from './fcm.sender';

type NotificationsConfig = ConfigType<typeof notificationsConfig>;

const logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() } as unknown as LoggerService;

/** A throwaway key pair, so the JWT signing path runs for real in tests. */
const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

function config(overrides: Partial<NotificationsConfig['fcm']> = {}): NotificationsConfig {
  return {
    fcm: {
      projectId: 'zassdelivery',
      clientEmail: 'push@zassdelivery.iam.gserviceaccount.com',
      privateKey,
      ...overrides,
    },
    pushConcurrency: 5,
    broadcastBatchSize: 500,
    maxPushFailures: 5,
  };
}

const MESSAGE = {
  token: 'device-a',
  title: 'Your order is on the way',
  body: 'Bilal is 5 minutes away.',
  data: { orderId: 'order-1' },
};

/** Stands in for the two endpoints the sender talks to. */
function mockFetch(handlers: {
  token?: () => { ok: boolean; body: unknown };
  send?: (url: string, init: RequestInit) => { ok: boolean; status?: number; body: unknown };
}) {
  return jest.fn((url: string, init: RequestInit) => {
    if (url.includes('oauth2.googleapis.com')) {
      const result = handlers.token?.() ?? {
        ok: true,
        body: { access_token: 'ya29.token', expires_in: 3600 },
      };

      return Promise.resolve({
        ok: result.ok,
        status: result.ok ? 200 : 401,
        json: () => Promise.resolve(result.body),
      });
    }

    const result = handlers.send?.(url, init) ?? {
      ok: true,
      body: { name: 'projects/zassdelivery/messages/1' },
    };

    return Promise.resolve({
      ok: result.ok,
      status: result.status ?? (result.ok ? 200 : 400),
      json: () => Promise.resolve(result.body),
    });
  });
}

describe('FcmSender.isConfigured', () => {
  it('is configured with a project, a client email and a key', () => {
    expect(new FcmSender(config(), logger).isConfigured()).toBe(true);
  });

  it('is unconfigured without a private key', () => {
    expect(new FcmSender(config({ privateKey: '' }), logger).isConfigured()).toBe(false);
  });

  it('is unconfigured without a project id', () => {
    expect(new FcmSender(config({ projectId: '' }), logger).isConfigured()).toBe(false);
  });
});

describe('FcmSender.send', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('delivers a message and returns the provider message id', async () => {
    global.fetch = mockFetch({}) as unknown as typeof fetch;

    const outcome = await new FcmSender(config(), logger).send(MESSAGE);

    expect(outcome.delivered).toBe(true);
    expect(outcome.messageId).toBe('projects/zassdelivery/messages/1');
    expect(outcome.tokenIsDead).toBe(false);
  });

  it('posts to the project’s messages:send endpoint with a bearer token', async () => {
    const fetchMock = mockFetch({});
    global.fetch = fetchMock as unknown as typeof fetch;

    await new FcmSender(config(), logger).send(MESSAGE);

    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];

    expect(url).toBe('https://fcm.googleapis.com/v1/projects/zassdelivery/messages:send');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer ya29.token');
  });

  it('sends the title, body and data the caller gave it', async () => {
    const fetchMock = mockFetch({});
    global.fetch = fetchMock as unknown as typeof fetch;

    await new FcmSender(config(), logger).send(MESSAGE);

    const sendCall = fetchMock.mock.calls[1] as [string, RequestInit];
    const body = JSON.parse(sendCall[1].body as string) as {
      message: {
        token: string;
        notification: Record<string, string>;
        data: Record<string, string>;
      };
    };

    expect(body.message.token).toBe('device-a');
    expect(body.message.notification).toEqual({
      title: 'Your order is on the way',
      body: 'Bilal is 5 minutes away.',
    });
    expect(body.message.data).toEqual({ orderId: 'order-1' });
  });

  it('asks for high priority only when the caller does', async () => {
    const fetchMock = mockFetch({});
    global.fetch = fetchMock as unknown as typeof fetch;
    const sender = new FcmSender(config(), logger);

    await sender.send({ ...MESSAGE, highPriority: true });
    const sendCall = fetchMock.mock.calls[1] as [string, RequestInit];
    const urgent = JSON.parse(sendCall[1].body as string) as {
      message: { android: { priority: string }; apns: { headers: Record<string, string> } };
    };

    expect(urgent.message.android.priority).toBe('HIGH');
    expect(urgent.message.apns.headers['apns-priority']).toBe('10');
  });

  it('marks an UNREGISTERED token as dead', async () => {
    global.fetch = mockFetch({
      send: () => ({
        ok: false,
        status: 404,
        body: { error: { status: 'UNREGISTERED', message: 'Requested entity was not found.' } },
      }),
    }) as unknown as typeof fetch;

    const outcome = await new FcmSender(config(), logger).send(MESSAGE);

    expect(outcome.delivered).toBe(false);
    expect(outcome.tokenIsDead).toBe(true);
  });

  it('does not mark a token dead on a server error', async () => {
    global.fetch = mockFetch({
      send: () => ({
        ok: false,
        status: 503,
        body: { error: { status: 'UNAVAILABLE', message: 'Backend unavailable.' } },
      }),
    }) as unknown as typeof fetch;

    const outcome = await new FcmSender(config(), logger).send(MESSAGE);

    // A bad moment says nothing about the token.
    expect(outcome.delivered).toBe(false);
    expect(outcome.tokenIsDead).toBe(false);
    expect(outcome.error).toBe('Backend unavailable.');
  });

  it('does not mark a token dead when the network fails', async () => {
    global.fetch = jest.fn((url: string) =>
      url.includes('oauth2')
        ? Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({ access_token: 'ya29.token', expires_in: 3600 }),
          })
        : Promise.reject(new Error('socket hang up')),
    ) as unknown as typeof fetch;

    const outcome = await new FcmSender(config(), logger).send(MESSAGE);

    expect(outcome.delivered).toBe(false);
    expect(outcome.tokenIsDead).toBe(false);
    expect(outcome.error).toBe('socket hang up');
  });

  it('reports every message as failed when it cannot authenticate', async () => {
    global.fetch = mockFetch({
      token: () => ({ ok: false, body: { error: 'invalid_grant' } }),
    }) as unknown as typeof fetch;

    const outcome = await new FcmSender(config(), logger).send(MESSAGE);

    expect(outcome.delivered).toBe(false);
    expect(outcome.error).toMatch(/authenticate/);
  });

  it('does not call Firebase at all when unconfigured', async () => {
    const fetchMock = mockFetch({});
    global.fetch = fetchMock as unknown as typeof fetch;

    const outcome = await new FcmSender(config({ privateKey: '' }), logger).send(MESSAGE);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(outcome.error).toMatch(/not configured/);
  });
});

describe('FcmSender.sendMany', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('returns one outcome per message, in order', async () => {
    global.fetch = mockFetch({
      send: (_url, init) => {
        const body = JSON.parse(init.body as string) as { message: { token: string } };

        return {
          ok: body.message.token !== 'dead',
          status: body.message.token === 'dead' ? 404 : 200,
          body:
            body.message.token === 'dead'
              ? { error: { status: 'UNREGISTERED', message: 'gone' } }
              : { name: `projects/zassdelivery/messages/${body.message.token}` },
        };
      },
    }) as unknown as typeof fetch;

    const outcomes = await new FcmSender(config(), logger).sendMany([
      { ...MESSAGE, token: 'phone' },
      { ...MESSAGE, token: 'dead' },
      { ...MESSAGE, token: 'tablet' },
    ]);

    expect(outcomes.map((outcome) => outcome.token)).toEqual(['phone', 'dead', 'tablet']);
    expect(outcomes.map((outcome) => outcome.delivered)).toEqual([true, false, true]);
    expect(outcomes[1]?.tokenIsDead).toBe(true);
  });

  it('authenticates once for a whole batch rather than per message', async () => {
    const fetchMock = mockFetch({});
    global.fetch = fetchMock as unknown as typeof fetch;

    await new FcmSender(config(), logger).sendMany(
      Array.from({ length: 12 }, (_, index) => ({ ...MESSAGE, token: `device-${index}` })),
    );

    const tokenCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).includes('oauth2.googleapis.com'),
    );

    expect(tokenCalls).toHaveLength(1);
  });

  it('reuses the cached access token across separate batches', async () => {
    const fetchMock = mockFetch({});
    global.fetch = fetchMock as unknown as typeof fetch;
    const sender = new FcmSender(config(), logger);

    await sender.sendMany([MESSAGE]);
    await sender.sendMany([MESSAGE]);

    const tokenCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).includes('oauth2.googleapis.com'),
    );

    expect(tokenCalls).toHaveLength(1);
  });

  it('does nothing for an empty batch', async () => {
    const fetchMock = mockFetch({});
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(new FcmSender(config(), logger).sendMany([])).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
