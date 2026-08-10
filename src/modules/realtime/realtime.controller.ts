import { Controller, Get, Inject, Param } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { ConfigType } from '@nestjs/config';

import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { RequirePermissions } from '@/common/decorators/permissions.decorator';
import { ApiErrorResponseDto } from '@/common/dto/api-response.dto';
import { ResourceNotFoundException } from '@/common/exceptions/domain.exception';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import { appConfig } from '@/config';

import {
  OrderChannelDto,
  RealtimeHandshakeDto,
  RealtimePresenceDto,
} from './application/dto/realtime-response.dto';
import { RealtimeService } from './application/realtime.service';
import { ClientEvents, ServerEvents } from './domain/events';
import { RealtimeAccessRepository } from './domain/repositories/realtime-access.repository';
import { Rooms } from './domain/rooms';
import { SocketAuthenticator } from './infrastructure/socket-authenticator';

/**
 * The socket protocol, described over HTTP.
 *
 * OpenAPI has no way to express a websocket, and a protocol that only exists in
 * a README is a protocol client developers get wrong. These endpoints put the
 * event catalogue, the authentication shape and the reconnect window in Swagger
 * alongside everything else — and `/handshake` returns it as data, so a client
 * can be built against the response rather than against prose.
 */
@ApiTags('Realtime')
@ApiBearerAuth('access-token')
@ApiResponse({ status: 401, description: 'Not authenticated.', type: ApiErrorResponseDto })
@Controller('realtime')
export class RealtimeController {
  constructor(
    private readonly realtime: RealtimeService,
    private readonly access: RealtimeAccessRepository,
    @Inject(appConfig.KEY)
    private readonly application: ConfigType<typeof appConfig>,
  ) {}

  @Get('handshake')
  @ApiOperation({
    summary: 'How to connect, and what you will hear',
    description:
      'Everything needed to open a live connection: the namespace, how the ' +
      'access token is presented, the reconnect window, and the full catalogue ' +
      'of commands and events. Read it rather than hard-coding event names — a ' +
      'mistyped one does not error, it just never fires.',
  })
  @ApiResponse({ status: 200, type: RealtimeHandshakeDto })
  handshake(@CurrentUser() actor: AuthenticatedUser): RealtimeHandshakeDto {
    const rooms = [Rooms.user(actor.id)];

    if (SocketAuthenticator.isStaff(actor)) {
      rooms.push(Rooms.dispatch());
    }

    return {
      url: `${this.application.isProduction ? 'wss' : 'ws'}://localhost:${this.application.port}/realtime`,
      namespace: '/realtime',
      authentication: "io(url, { auth: { token: '<accessToken>' } })",
      transports: ['websocket', 'polling'],
      reconnectWindowSeconds: 120,
      autoJoinedRooms: [...rooms, 'rider:<yourDriverId> — riders only'],
      commands: [
        {
          event: ClientEvents.orderSubscribe,
          payload: '{ "orderId": "cmsd…" }',
          description:
            'Watch one order. Acknowledged, then answered with an ' +
            `\`${ServerEvents.orderSnapshot}\` carrying its current state — which is ` +
            'how a client that was offline resyncs without reasoning about what it missed.',
        },
        {
          event: ClientEvents.orderUnsubscribe,
          payload: '{ "orderId": "cmsd…" }',
          description: 'Stop watching an order.',
        },
        {
          event: ClientEvents.restaurantSubscribe,
          payload: '{ "restaurantId": "cmsd…" }',
          description: 'Watch a kitchen’s incoming tickets. Owner and staff only.',
        },
        {
          event: ClientEvents.restaurantUnsubscribe,
          payload: '{ "restaurantId": "cmsd…" }',
          description: 'Stop watching a kitchen.',
        },
        {
          event: ClientEvents.riderLocation,
          payload: '{ "latitude": 34.0151, "longitude": 71.7938 }',
          description:
            'Riders only. Attributed to your own live delivery — the order is ' +
            'resolved server-side, never taken from the payload. Broadcast ' +
            'immediately; persisted at most once every 15 seconds.',
        },
        {
          event: ClientEvents.ping,
          payload: '{}',
          description: 'Round trip, for measuring latency.',
        },
      ],
      events: [
        {
          event: ServerEvents.ready,
          description:
            'Sent once after a successful handshake. `recovered` tells you ' +
            'whether Socket.IO replayed what you missed or this is a fresh session.',
          room: 'your socket',
        },
        {
          event: ServerEvents.orderSnapshot,
          description: 'The full current state of an order. Sent on every subscribe.',
          room: 'order:<orderId>',
        },
        {
          event: ServerEvents.orderStatus,
          description: 'One lifecycle transition.',
          room: 'order:<orderId>',
        },
        {
          event: ServerEvents.riderLocation,
          description: 'A rider’s position, with the distance left to the drop-off.',
          room: 'order:<orderId> · dispatch',
        },
        {
          event: ServerEvents.riderAssigned,
          description: 'A rider has taken the delivery; carries their name and number.',
          room: 'order:<orderId> · dispatch',
        },
        {
          event: ServerEvents.deliveryOffered,
          description: 'A delivery offered to you, with what it pays and when it expires.',
          room: 'rider:<driverId>',
        },
        {
          event: ServerEvents.restaurantOrder,
          description: 'A new ticket for the kitchen.',
          room: 'restaurant:<restaurantId>',
        },
        {
          event: ServerEvents.restaurantOrderUpdated,
          description: 'An existing ticket changed — cancelled, paid or collected.',
          room: 'restaurant:<restaurantId>',
        },
        {
          event: ServerEvents.notification,
          description: 'An in-app notification, delivered live rather than on the next poll.',
          room: 'user:<yourId>',
        },
        {
          event: ServerEvents.subscriptionError,
          description: 'A subscription that could not be honoured, and why.',
          room: 'your socket',
        },
      ],
    };
  }

  @Get('orders/:orderId/channel')
  @ApiParam({ name: 'orderId' })
  @ApiOperation({
    summary: 'The live channel for one order',
    description:
      'Confirms you may watch this order and names the room, so a client can ' +
      'check before opening a socket. Returns 404 for an order that is not ' +
      'yours — the same answer as one that does not exist.',
  })
  @ApiResponse({ status: 200, type: OrderChannelDto })
  @ApiResponse({ status: 404, description: 'Not found, or not yours.' })
  async orderChannel(
    @Param('orderId') orderId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<OrderChannelDto> {
    const allowed = await this.access.canAccessOrder(
      actor.id,
      SocketAuthenticator.isStaff(actor),
      orderId,
    );

    const snapshot = allowed ? await this.access.orderSnapshot(orderId) : null;

    if (snapshot === null) {
      throw new ResourceNotFoundException('Order', orderId);
    }

    return {
      room: Rooms.order(orderId),
      orderId: snapshot.id,
      orderNumber: snapshot.orderNumber,
      status: snapshot.status,
      hasRider: snapshot.driverId !== null,
      estimatedDeliveryAt: snapshot.estimatedDeliveryAt,
    };
  }

  @Get('presence')
  @RequirePermissions('orders.read')
  @ApiOperation({
    summary: 'Who is connected',
    description:
      'Counted across every API instance through the Redis adapter, so this is ' +
      'the real number rather than whatever this process happens to be holding.',
  })
  @ApiResponse({ status: 200, type: RealtimePresenceDto })
  async presence(): Promise<RealtimePresenceDto> {
    return {
      connections: await this.realtime.connectionCount(),
      gatewayReady: this.realtime.isLive,
      dispatchWatchers: await this.realtime.roomSize(Rooms.dispatch()),
    };
  }
}
