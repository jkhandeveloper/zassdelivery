import { createSign } from 'node:crypto';

import { Inject, Injectable, type LoggerService } from '@nestjs/common';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import type { ConfigType } from '@nestjs/config';

import { notificationsConfig } from '@/config';

import { PushSender, type PushMessage, type PushOutcome } from '../../domain/services/push-sender';

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';

/** Access tokens last an hour; refreshed early so none expires mid-broadcast. */
const TOKEN_TTL_SECONDS = 3600;
const TOKEN_REFRESH_MARGIN_MS = 5 * 60_000;

const SEND_TIMEOUT_MS = 10_000;

/**
 * FCM error codes that mean the token will never work again.
 *
 * Distinguishing these from transient failures is the whole of token hygiene:
 * retiring on a timeout loses a real device, and not retiring on UNREGISTERED
 * leaves the platform pushing at uninstalled apps forever.
 */
const DEAD_TOKEN_CODES = ['UNREGISTERED', 'INVALID_ARGUMENT', 'NOT_FOUND', 'SENDER_ID_MISMATCH'];

function base64Url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Firebase Cloud Messaging over the HTTP v1 API.
 *
 * Written directly against the REST API rather than pulling in `firebase-admin`:
 * the platform needs exactly one call from that SDK, and the whole of what it
 * would provide here is a signed JWT, an OAuth exchange and a POST. The
 * dependency would be about forty megabytes of transitive packages for those
 * three things, and it would still need the same error handling underneath.
 */
@Injectable()
export class FcmSender extends PushSender {
  readonly name = 'fcm';

  private readonly context = FcmSender.name;

  /** Cached OAuth token, so a broadcast does not re-authenticate per message. */
  private accessToken: { value: string; expiresAt: number } | null = null;
  /** In-flight token request, so a burst of sends triggers one exchange. */
  private pending: Promise<string | null> | null = null;

  constructor(
    @Inject(notificationsConfig.KEY)
    private readonly config: ConfigType<typeof notificationsConfig>,
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: LoggerService,
  ) {
    super();
  }

  isConfigured(): boolean {
    const { projectId, clientEmail, privateKey } = this.config.fcm;

    return projectId !== '' && clientEmail !== '' && privateKey !== '';
  }

  async send(message: PushMessage): Promise<PushOutcome> {
    const [outcome] = await this.sendMany([message]);

    return (
      outcome ?? {
        token: message.token,
        delivered: false,
        messageId: null,
        error: 'No outcome returned.',
        tokenIsDead: false,
      }
    );
  }

  /**
   * Sends to many devices with bounded concurrency.
   *
   * HTTP v1 has no batch endpoint — even the official SDK loops — so the work
   * here is keeping that loop from opening a socket per phone. A broadcast to
   * ten thousand devices runs at a fixed width instead.
   */
  async sendMany(messages: PushMessage[]): Promise<PushOutcome[]> {
    if (messages.length === 0) {
      return [];
    }

    if (!this.isConfigured()) {
      return messages.map((message) => ({
        token: message.token,
        delivered: false,
        messageId: null,
        error: 'Push is not configured on this deployment.',
        tokenIsDead: false,
      }));
    }

    const token = await this.authenticate();

    if (token === null) {
      return messages.map((message) => ({
        token: message.token,
        delivered: false,
        messageId: null,
        error: 'Could not authenticate with Firebase.',
        tokenIsDead: false,
      }));
    }

    const outcomes: PushOutcome[] = new Array<PushOutcome>(messages.length);
    const width = Math.max(1, this.config.pushConcurrency);
    let cursor = 0;

    const worker = async (): Promise<void> => {
      while (cursor < messages.length) {
        const index = cursor;
        cursor += 1;

        const message = messages[index];
        if (message !== undefined) {
          outcomes[index] = await this.deliver(message, token);
        }
      }
    };

    await Promise.all(Array.from({ length: Math.min(width, messages.length) }, worker));

    return outcomes;
  }

  private async deliver(message: PushMessage, accessToken: string): Promise<PushOutcome> {
    const url = `https://fcm.googleapis.com/v1/projects/${this.config.fcm.projectId}/messages:send`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ message: this.buildPayload(message) }),
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      });

      const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;

      if (response.ok) {
        return {
          token: message.token,
          delivered: true,
          messageId: typeof body.name === 'string' ? body.name : null,
          error: null,
          tokenIsDead: false,
        };
      }

      const error = body.error as { status?: string; message?: string } | undefined;
      const status = error?.status ?? String(response.status);

      return {
        token: message.token,
        delivered: false,
        messageId: null,
        error: error?.message ?? `Firebase responded ${response.status}.`,
        // A 404 from FCM means this registration token no longer exists.
        tokenIsDead: DEAD_TOKEN_CODES.includes(status) || response.status === 404,
      };
    } catch (error) {
      // A network failure says nothing about the token, only about the moment.
      return {
        token: message.token,
        delivered: false,
        messageId: null,
        error: (error as Error).message,
        tokenIsDead: false,
      };
    }
  }

  private buildPayload(message: PushMessage): Record<string, unknown> {
    return {
      token: message.token,
      notification: { title: message.title, body: message.body },
      // Every data value must be a string; FCM rejects anything else, and a
      // number slipped in here fails the whole message rather than the field.
      data: message.data ?? {},
      android: {
        priority: message.highPriority === true ? 'HIGH' : 'NORMAL',
        notification: { sound: 'default', channelId: 'zass_default' },
      },
      apns: {
        headers: { 'apns-priority': message.highPriority === true ? '10' : '5' },
        payload: { aps: { sound: 'default' } },
      },
    };
  }

  /**
   * Exchanges the service account key for an OAuth access token.
   *
   * Cached until shortly before expiry, and de-duplicated: a broadcast starting
   * twenty-five workers at once should perform one token exchange, not
   * twenty-five.
   */
  private async authenticate(): Promise<string | null> {
    if (this.accessToken !== null && this.accessToken.expiresAt > Date.now()) {
      return this.accessToken.value;
    }

    this.pending ??= this.requestToken().finally(() => {
      this.pending = null;
    });

    return this.pending;
  }

  private async requestToken(): Promise<string | null> {
    try {
      const assertion = this.signAssertion();

      const response = await fetch(TOKEN_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
          assertion,
        }).toString(),
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      });

      if (!response.ok) {
        this.logger.error?.(
          `Firebase rejected the service account credentials (${response.status})`,
          undefined,
          this.context,
        );

        return null;
      }

      const body = (await response.json()) as { access_token?: string; expires_in?: number };

      if (typeof body.access_token !== 'string') {
        return null;
      }

      this.accessToken = {
        value: body.access_token,
        expiresAt:
          Date.now() + (body.expires_in ?? TOKEN_TTL_SECONDS) * 1000 - TOKEN_REFRESH_MARGIN_MS,
      };

      return this.accessToken.value;
    } catch (error) {
      this.logger.error?.(
        `Could not reach Google's token endpoint: ${(error as Error).message}`,
        undefined,
        this.context,
      );

      return null;
    }
  }

  /** The RS256 JWT Google exchanges for an access token. */
  private signAssertion(): string {
    const issuedAt = Math.floor(Date.now() / 1000);

    const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const claims = base64Url(
      JSON.stringify({
        iss: this.config.fcm.clientEmail,
        scope: SCOPE,
        aud: TOKEN_ENDPOINT,
        iat: issuedAt,
        exp: issuedAt + TOKEN_TTL_SECONDS,
      }),
    );

    const signature = createSign('RSA-SHA256')
      .update(`${header}.${claims}`)
      .sign(this.config.fcm.privateKey);

    return `${header}.${claims}.${base64Url(signature)}`;
  }
}
