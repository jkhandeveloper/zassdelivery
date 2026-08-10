import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import type { INestApplicationContext, LoggerService } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import type Redis from 'ioredis';
import type { Server, ServerOptions } from 'socket.io';

import type { appConfig } from '@/config';

/**
 * Socket.IO backed by Redis pub/sub.
 *
 * Without this, a platform running more than one API instance delivers events
 * only to the clients that happen to be connected to the instance the event was
 * emitted from. A customer watching their order on instance A would see nothing
 * when the rider's app, connected to instance B, reported a position — and the
 * failure is invisible in development, where there is only ever one instance.
 *
 * The adapter is optional at boot: if Redis cannot be reached the server still
 * starts and serves a single instance correctly, because a delivery platform
 * that will not accept orders is worse than one whose live map is stale.
 */
export class RedisIoAdapter extends IoAdapter {
  private adapterFactory: ReturnType<typeof createAdapter> | null = null;

  constructor(
    app: INestApplicationContext,
    private readonly redis: Redis,
    private readonly application: ConfigType<typeof appConfig>,
    private readonly logger: LoggerService,
  ) {
    super(app);
  }

  /**
   * Opens the two connections the adapter needs.
   *
   * A subscriber connection cannot issue ordinary commands, so it must be its
   * own client — hence duplicating rather than reusing the application's.
   */
  async connect(): Promise<void> {
    try {
      const publisher = this.redis.duplicate();
      const subscriber = this.redis.duplicate();

      await Promise.all([publisher.connect(), subscriber.connect()]);

      this.adapterFactory = createAdapter(publisher, subscriber);
      this.logger.log?.('Socket.IO is using the Redis adapter', RedisIoAdapter.name);
    } catch (error) {
      this.logger.warn?.(
        `Socket.IO could not reach Redis (${(error as Error).message}). ` +
          'Running single-instance: events will not cross API instances.',
        RedisIoAdapter.name,
      );
    }
  }

  createIOServer(port: number, options?: ServerOptions): Server {
    const server = super.createIOServer(port, {
      ...options,
      cors: {
        origin: this.application.corsOrigins,
        credentials: true,
      },
      // Reconnect support, part one: Socket.IO buffers a dropped session and
      // replays what it missed when the same client comes back inside the
      // window. That covers a tunnel, a lift, a handover between cell towers —
      // the cases where a customer never even notices the drop.
      //
      // Part two lives in the gateway: a resubscribe always answers with the
      // current snapshot, because two minutes is not long enough for a rider
      // whose phone died and it is the longer gaps that lose people.
      connectionStateRecovery: {
        maxDisconnectionDuration: 2 * 60 * 1000,
        skipMiddlewares: false,
      },
      // Long-polling stays enabled as a fallback: mobile networks in the target
      // market are not uniformly websocket-friendly, and a customer on a bad
      // connection should get a slow live map rather than none.
      transports: ['websocket', 'polling'],
      pingInterval: 20_000,
      pingTimeout: 25_000,
    }) as Server;

    if (this.adapterFactory !== null) {
      server.adapter(this.adapterFactory);
    }

    return server;
  }
}
