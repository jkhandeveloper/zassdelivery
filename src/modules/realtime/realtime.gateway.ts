import { Inject, type LoggerService } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import type { Server, Socket } from 'socket.io';

import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import { haversineKm } from '@/common/utils/geo.util';

import { RealtimeService } from './application/realtime.service';
import { ClientEvents, ServerEvents } from './domain/events';
import type { OrderSnapshotPayload, RiderLocationPayload, SubscriptionAck } from './domain/events';
import { RealtimeAccessRepository } from './domain/repositories/realtime-access.repository';
import { Rooms } from './domain/rooms';
import { SocketAuthenticator } from './infrastructure/socket-authenticator';

/** How often a rider's position is written to the database, per rider. */
const LOCATION_PERSIST_INTERVAL_MS = 15_000;

/** Positions closer together than this are not worth a broadcast. */
const LOCATION_MIN_MOVEMENT_KM = 0.02;

interface SocketState {
  user: AuthenticatedUser;
  driverId: string | null;
  lastPersistedAt: number;
  lastPosition: { latitude: number; longitude: number } | null;
}

/**
 * The live channel.
 *
 * One gateway rather than one per feature: a client should open a single
 * connection and subscribe to what it cares about, not hold four sockets open
 * on a mobile connection because the server was organised by module.
 *
 * Authorisation happens twice, deliberately. The handshake proves *who* the
 * client is; every subscribe proves they may see *that* thing. A socket that
 * authenticated an hour ago is not a socket entitled to whatever room it names.
 */
@WebSocketGateway({ namespace: '/realtime' })
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  private readonly context = RealtimeGateway.name;

  /** Per-connection state, keyed by socket id. Cleared on disconnect. */
  private readonly state = new Map<string, SocketState>();

  constructor(
    private readonly authenticator: SocketAuthenticator,
    private readonly access: RealtimeAccessRepository,
    private readonly realtime: RealtimeService,
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: LoggerService,
  ) {}

  afterInit(server: Server): void {
    // Handing the server to the service is what lets every other module publish
    // without importing Socket.IO.
    this.realtime.bind(server);
    this.logger.log?.('Realtime gateway listening on /realtime', this.context);
  }

  /**
   * Authenticates, then places the client in the rooms it is entitled to
   * without being asked.
   *
   * A rider's app should receive delivery offers the moment it connects; making
   * it subscribe first would mean an offer sent in that gap is simply lost.
   */
  async handleConnection(socket: Socket): Promise<void> {
    let user: AuthenticatedUser;

    try {
      user = await this.authenticator.authenticate(socket);
    } catch (error) {
      // Told to the client, then closed. A socket that lingers unauthenticated
      // is a socket that will be used unauthenticated.
      socket.emit(ServerEvents.subscriptionError, {
        room: 'connection',
        reason: (error as Error).message,
      });
      socket.disconnect(true);

      return;
    }

    const driverId = await this.access.driverIdForUser(user.id);
    const isStaff = SocketAuthenticator.isStaff(user);

    this.state.set(socket.id, {
      user,
      driverId,
      lastPersistedAt: 0,
      lastPosition: null,
    });

    const rooms = [Rooms.user(user.id)];

    if (driverId !== null) {
      rooms.push(Rooms.rider(driverId));
    }

    if (isStaff) {
      rooms.push(Rooms.dispatch());
    }

    await socket.join(rooms);

    socket.emit(ServerEvents.ready, {
      userId: user.id,
      role: user.role,
      rooms,
      // Tells the client whether Socket.IO replayed what it missed, or whether
      // this is a fresh session that needs to resubscribe and resync.
      recovered: socket.recovered,
      serverTime: new Date().toISOString(),
    });
  }

  handleDisconnect(socket: Socket): void {
    this.state.delete(socket.id);
  }

  // ── Orders ─────────────────────────────────────────────────

  /**
   * Watches one order, and answers with its current state.
   *
   * The snapshot in the acknowledgement is the second half of reconnect
   * support. Socket.IO's own recovery covers a brief drop; a phone that was off
   * for an hour comes back to a screen that would otherwise show whatever was
   * true when it died. Answering every subscribe with the truth means a client
   * never has to reason about what it missed.
   */
  @SubscribeMessage(ClientEvents.orderSubscribe)
  async subscribeToOrder(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: { orderId?: unknown },
  ): Promise<SubscriptionAck> {
    const state = this.state.get(socket.id);
    const orderId = typeof body?.orderId === 'string' ? body.orderId : null;

    if (state === undefined || orderId === null) {
      return this.reject(socket, 'order', 'An orderId is required.');
    }

    const allowed = await this.access.canAccessOrder(
      state.user.id,
      SocketAuthenticator.isStaff(state.user),
      orderId,
    );

    if (!allowed) {
      // Same answer whether the order does not exist or is somebody else's:
      // the difference is a way to discover which order ids are real.
      return this.reject(socket, Rooms.order(orderId), 'That order is not available to you.');
    }

    const room = Rooms.order(orderId);
    await socket.join(room);

    const snapshot = await this.buildSnapshot(orderId);

    if (snapshot !== null) {
      socket.emit(ServerEvents.orderSnapshot, snapshot);
    }

    // Also in the acknowledgement: a callback-style client has not attached its
    // listener yet when the emit above fires, and would miss the snapshot it
    // just asked for.
    return { ok: true, room, error: null, ...(snapshot !== null && { snapshot }) };
  }

  @SubscribeMessage(ClientEvents.orderUnsubscribe)
  async unsubscribeFromOrder(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: { orderId?: unknown },
  ): Promise<SubscriptionAck> {
    const orderId = typeof body?.orderId === 'string' ? body.orderId : null;

    if (orderId === null) {
      return { ok: false, room: null, error: 'An orderId is required.' };
    }

    await socket.leave(Rooms.order(orderId));

    return { ok: true, room: Rooms.order(orderId), error: null };
  }

  // ── Restaurants ────────────────────────────────────────────

  /** A kitchen dashboard, watching its own incoming tickets. */
  @SubscribeMessage(ClientEvents.restaurantSubscribe)
  async subscribeToRestaurant(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: { restaurantId?: unknown },
  ): Promise<SubscriptionAck> {
    const state = this.state.get(socket.id);
    const restaurantId = typeof body?.restaurantId === 'string' ? body.restaurantId : null;

    if (state === undefined || restaurantId === null) {
      return this.reject(socket, 'restaurant', 'A restaurantId is required.');
    }

    const allowed = await this.access.canAccessRestaurant(
      state.user.id,
      SocketAuthenticator.isStaff(state.user),
      restaurantId,
    );

    if (!allowed) {
      return this.reject(
        socket,
        Rooms.restaurant(restaurantId),
        'That restaurant is not available to you.',
      );
    }

    const room = Rooms.restaurant(restaurantId);
    await socket.join(room);

    return { ok: true, room, error: null };
  }

  @SubscribeMessage(ClientEvents.restaurantUnsubscribe)
  async unsubscribeFromRestaurant(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: { restaurantId?: unknown },
  ): Promise<SubscriptionAck> {
    const restaurantId = typeof body?.restaurantId === 'string' ? body.restaurantId : null;

    if (restaurantId === null) {
      return { ok: false, room: null, error: 'A restaurantId is required.' };
    }

    await socket.leave(Rooms.restaurant(restaurantId));

    return { ok: true, room: Rooms.restaurant(restaurantId), error: null };
  }

  // ── Rider tracking ─────────────────────────────────────────

  /**
   * A rider reporting where they are.
   *
   * Broadcast immediately, written to the database at most once every fifteen
   * seconds. A phone reporting every second is fifteen times more useful on a
   * customer's map than in a write-ahead log, and persisting every one of them
   * would mean a hundred riders producing a hundred writes a second for data
   * that is stale before it is committed. What is persisted is the fallback the
   * snapshot reads when a customer reconnects.
   *
   * The position is only ever attributed to the rider's own live delivery: a
   * rider cannot report a location onto somebody else's order, whatever they
   * put in the payload.
   */
  @SubscribeMessage(ClientEvents.riderLocation)
  async reportLocation(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: { latitude?: unknown; longitude?: unknown },
  ): Promise<SubscriptionAck> {
    const state = this.state.get(socket.id);

    if (state === undefined || state.driverId === null) {
      return { ok: false, room: null, error: 'Only a registered rider can report a position.' };
    }

    const latitude = Number(body?.latitude);
    const longitude = Number(body?.longitude);

    if (!this.isCoordinate(latitude, -90, 90) || !this.isCoordinate(longitude, -180, 180)) {
      return { ok: false, room: null, error: 'latitude and longitude must be valid coordinates.' };
    }

    // A parked rider still sends a position every few seconds; broadcasting
    // those would fill a customer's socket with a stationary dot.
    const moved =
      state.lastPosition === null ||
      haversineKm(state.lastPosition.latitude, state.lastPosition.longitude, latitude, longitude) >=
        LOCATION_MIN_MOVEMENT_KM;

    state.lastPosition = { latitude, longitude };

    if (!moved) {
      return { ok: true, room: null, error: null };
    }

    const orderId = await this.access.activeOrderForDriver(state.driverId);
    const payload: RiderLocationPayload = {
      orderId,
      driverId: state.driverId,
      latitude,
      longitude,
      distanceKm: await this.distanceToDropOff(orderId, latitude, longitude),
      at: new Date().toISOString(),
    };

    this.realtime.riderMoved(payload);

    const now = Date.now();

    if (now - state.lastPersistedAt >= LOCATION_PERSIST_INTERVAL_MS) {
      state.lastPersistedAt = now;

      try {
        await this.access.saveDriverLocation(state.driverId, latitude, longitude);
      } catch (error) {
        // The broadcast has already gone out; a failed write costs the fallback
        // position, not the live one.
        this.logger.warn?.(
          `Could not persist a position for rider ${state.driverId}: ${(error as Error).message}`,
          this.context,
        );
      }
    }

    return { ok: true, room: orderId === null ? null : Rooms.order(orderId), error: null };
  }

  /** Round trip, so a client can measure its own latency. */
  @SubscribeMessage(ClientEvents.ping)
  handlePing(): { pong: true; at: string } {
    return { pong: true, at: new Date().toISOString() };
  }

  // ── Helpers ────────────────────────────────────────────────

  private async buildSnapshot(orderId: string): Promise<OrderSnapshotPayload | null> {
    const snapshot = await this.access.orderSnapshot(orderId);

    if (snapshot === null) {
      return null;
    }

    return {
      orderId: snapshot.id,
      orderNumber: snapshot.orderNumber,
      status: snapshot.status,
      statusText: snapshot.status,
      actor: null,
      at: snapshot.updatedAt.toISOString(),
      restaurantName: snapshot.restaurantName,
      estimatedDeliveryAt: snapshot.estimatedDeliveryAt?.toISOString() ?? null,
      rider: snapshot.rider,
      riderLocation:
        snapshot.riderLocation === null || snapshot.driverId === null
          ? null
          : {
              orderId: snapshot.id,
              driverId: snapshot.driverId,
              latitude: snapshot.riderLocation.latitude,
              longitude: snapshot.riderLocation.longitude,
              distanceKm:
                snapshot.deliveryLat === null || snapshot.deliveryLng === null
                  ? null
                  : haversineKm(
                      snapshot.riderLocation.latitude,
                      snapshot.riderLocation.longitude,
                      snapshot.deliveryLat,
                      snapshot.deliveryLng,
                    ),
              at: snapshot.riderLocation.at.toISOString(),
            },
    };
  }

  private async distanceToDropOff(
    orderId: string | null,
    latitude: number,
    longitude: number,
  ): Promise<number | null> {
    if (orderId === null) {
      return null;
    }

    const snapshot = await this.access.orderSnapshot(orderId);

    if (snapshot === null || snapshot.deliveryLat === null || snapshot.deliveryLng === null) {
      return null;
    }

    return haversineKm(latitude, longitude, snapshot.deliveryLat, snapshot.deliveryLng);
  }

  private reject(socket: Socket, room: string, reason: string): SubscriptionAck {
    // Both an acknowledgement and an event: clients that use callbacks get the
    // former, clients that only listen get the latter, and neither has to guess.
    socket.emit(ServerEvents.subscriptionError, { room, reason });

    return { ok: false, room: null, error: reason };
  }

  private isCoordinate(value: number, min: number, max: number): boolean {
    return Number.isFinite(value) && value >= min && value <= max;
  }
}
