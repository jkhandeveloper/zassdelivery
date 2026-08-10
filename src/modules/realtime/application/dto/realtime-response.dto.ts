import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { OrderStatus } from '@prisma/client';

export class RealtimeEventDto {
  @ApiProperty({ example: 'order:status' }) event!: string;
  @ApiProperty({ example: 'A lifecycle transition on an order you are watching.' })
  description!: string;
  @ApiProperty({
    example: 'order:<orderId>',
    description: 'The room this event is delivered to.',
  })
  room!: string;
}

export class RealtimeCommandDto {
  @ApiProperty({ example: 'order:subscribe' }) event!: string;
  @ApiProperty({ example: '{ "orderId": "cmsd…" }' }) payload!: string;
  @ApiProperty({ example: 'Watch one order. Answers with its current snapshot.' })
  description!: string;
}

export class RealtimeHandshakeDto {
  @ApiProperty({
    example: 'ws://localhost:3000/realtime',
    description: 'Namespace URL to connect a Socket.IO client to.',
  })
  url!: string;

  @ApiProperty({ example: '/realtime' }) namespace!: string;

  @ApiProperty({
    example: "io(url, { auth: { token: '<accessToken>' } })",
    description:
      'How to present the access token. It is also read from an Authorization ' +
      'header or a `token` query parameter, because browsers cannot set headers ' +
      'on the initial upgrade.',
  })
  authentication!: string;

  @ApiProperty({
    type: [String],
    example: ['websocket', 'polling'],
    description: 'Polling stays enabled as a fallback for unreliable mobile networks.',
  })
  transports!: string[];

  @ApiProperty({
    example: 120,
    description:
      'Seconds a dropped session is buffered for replay. Beyond it, resubscribe ' +
      'and the server answers with a fresh snapshot.',
  })
  reconnectWindowSeconds!: number;

  @ApiProperty({
    type: [String],
    example: ['user:<yourId>', 'rider:<yourDriverId>'],
    description: 'Rooms you are placed in automatically on connect.',
  })
  autoJoinedRooms!: string[];

  @ApiProperty({ type: [RealtimeCommandDto] }) commands!: RealtimeCommandDto[];
  @ApiProperty({ type: [RealtimeEventDto] }) events!: RealtimeEventDto[];
}

export class RealtimePresenceDto {
  @ApiProperty({ example: 42, description: 'Sockets connected across every API instance.' })
  connections!: number;
  @ApiProperty({ example: true, description: 'False before the gateway has finished starting.' })
  gatewayReady!: boolean;
  @ApiProperty({ example: 7, description: 'Sockets watching the dispatch board.' })
  dispatchWatchers!: number;
}

export class OrderChannelDto {
  @ApiProperty({ example: 'order:cmsd…' }) room!: string;
  @ApiProperty() orderId!: string;
  @ApiProperty({ example: 'ZD-260810-0007' }) orderNumber!: string;
  @ApiProperty({ enum: OrderStatus }) status!: OrderStatus;
  @ApiProperty({
    example: true,
    description: 'Whether a rider position feed is expected on this channel.',
  })
  hasRider!: boolean;
  @ApiPropertyOptional({ nullable: true }) estimatedDeliveryAt!: Date | null;
}
