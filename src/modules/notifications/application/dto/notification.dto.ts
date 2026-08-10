import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  BroadcastAudience,
  BroadcastStatus,
  DevicePlatform,
  NotificationChannel,
  NotificationType,
  UserRole,
} from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDate,
  IsEnum,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

import { PaginationQueryDto } from '@/common/dto/pagination-query.dto';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

const toBoolean = ({ value }: { value: unknown }): unknown => {
  if (typeof value === 'boolean') {
    return value;
  }
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  return value;
};

// ── Devices ────────────────────────────────────────────────────

export class RegisterDeviceDto {
  @ApiProperty({
    example: 'fMEP0vJqS0y…:APA91bH…',
    description: 'The FCM registration token from the app.',
    maxLength: 500,
  })
  @IsString()
  @MinLength(10)
  @MaxLength(500)
  @Transform(trim)
  token!: string;

  @ApiProperty({ enum: DevicePlatform, default: DevicePlatform.ANDROID })
  @IsEnum(DevicePlatform)
  platform!: DevicePlatform;

  @ApiPropertyOptional({
    example: 'a1b2c3d4-installation',
    description:
      'Stable per-installation id. Supply it and a refreshed token replaces ' +
      'its predecessor instead of leaving a dead registration behind.',
    maxLength: 120,
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Transform(trim)
  deviceId?: string;

  @ApiPropertyOptional({ example: 'Redmi Note 12', maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Transform(trim)
  deviceName?: string;

  @ApiPropertyOptional({ example: '1.4.2', maxLength: 40 })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  @Transform(trim)
  appVersion?: string;
}

export class UnregisterDeviceDto {
  @ApiProperty({ description: 'The token to stop sending to.', maxLength: 500 })
  @IsString()
  @MaxLength(500)
  @Transform(trim)
  token!: string;
}

export class TestPushDto {
  @ApiPropertyOptional({
    example: 'Testing push from the ZassDelivery dashboard.',
    maxLength: 200,
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  @Transform(trim)
  message?: string;
}

// ── History ────────────────────────────────────────────────────

export class ListNotificationsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: NotificationType })
  @IsOptional()
  @IsEnum(NotificationType)
  type?: NotificationType;

  @ApiPropertyOptional({ description: 'Only what has not been read yet.', default: false })
  @IsOptional()
  @Transform(toBoolean)
  unreadOnly?: boolean;

  @ApiPropertyOptional({ example: '2026-08-01T00:00:00.000Z' })
  @IsOptional()
  @Type(() => Date)
  @IsDate({ message: 'from must be a valid ISO 8601 date' })
  from?: Date;

  @ApiPropertyOptional({ example: '2026-08-31T23:59:59.999Z' })
  @IsOptional()
  @Type(() => Date)
  @IsDate({ message: 'to must be a valid ISO 8601 date' })
  to?: Date;
}

// ── Broadcasts ─────────────────────────────────────────────────

/** Channels a campaign may ask for. In-app and push are the ones we can send. */
const BROADCAST_CHANNELS = [NotificationChannel.IN_APP, NotificationChannel.PUSH] as const;

export class CreateBroadcastDto {
  @ApiProperty({ example: '30% off at Chapli Kabab House tonight', maxLength: 160 })
  @IsString()
  @MinLength(3)
  @MaxLength(160)
  @Transform(trim)
  title!: string;

  @ApiProperty({
    example: 'Order before 10pm and get 30% off your whole order. No code needed.',
    maxLength: 1000,
  })
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  @Transform(trim)
  body!: string;

  @ApiPropertyOptional({ enum: NotificationType, default: NotificationType.PROMOTION })
  @IsOptional()
  @IsEnum(NotificationType)
  type?: NotificationType;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    description: 'Deep-link payload, e.g. { "restaurantId": "…" }.',
    example: { restaurantId: 'cmsd…', screen: 'restaurant' },
  })
  @IsOptional()
  @IsObject()
  data?: Record<string, unknown>;

  @ApiProperty({
    enum: BroadcastAudience,
    default: BroadcastAudience.ALL,
    description:
      'ROLE needs roleFilter, ZONE needs zoneId, USER_IDS needs userIds. ' +
      'Suspended and deleted accounts are excluded from every audience.',
  })
  @IsEnum(BroadcastAudience)
  audience!: BroadcastAudience;

  @ApiPropertyOptional({ enum: UserRole, description: 'Required when audience is ROLE.' })
  @IsOptional()
  @IsEnum(UserRole)
  roleFilter?: UserRole;

  @ApiPropertyOptional({ description: 'Required when audience is ZONE.' })
  @IsOptional()
  @IsString()
  zoneId?: string;

  @ApiPropertyOptional({
    type: [String],
    description: 'Required when audience is USER_IDS. At most 1000 recipients.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(1000)
  @IsString({ each: true })
  userIds?: string[];

  @ApiPropertyOptional({
    enum: BROADCAST_CHANNELS,
    isArray: true,
    default: [NotificationChannel.IN_APP, NotificationChannel.PUSH],
    description: 'Intersected with each recipient’s own preferences before sending.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsIn(BROADCAST_CHANNELS, { each: true })
  channels?: Array<(typeof BROADCAST_CHANNELS)[number]>;

  @ApiPropertyOptional({
    example: '2026-08-11T14:00:00.000Z',
    description: 'Leave out to save as a draft and send by hand.',
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate({ message: 'scheduledFor must be a valid ISO 8601 date' })
  scheduledFor?: Date;
}

export class UpdateBroadcastDto extends CreateBroadcastDto {
  @ApiPropertyOptional({ example: 'Updated title', maxLength: 160 })
  declare title: string;

  @ApiPropertyOptional({ maxLength: 1000 })
  declare body: string;

  @ApiPropertyOptional({ enum: BroadcastAudience })
  declare audience: BroadcastAudience;
}

export class ListBroadcastsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: BroadcastStatus })
  @IsOptional()
  @IsEnum(BroadcastStatus)
  status?: BroadcastStatus;

  @ApiPropertyOptional({ example: '2026-08-01T00:00:00.000Z' })
  @IsOptional()
  @Type(() => Date)
  @IsDate({ message: 'from must be a valid ISO 8601 date' })
  from?: Date;

  @ApiPropertyOptional({ example: '2026-08-31T23:59:59.999Z' })
  @IsOptional()
  @Type(() => Date)
  @IsDate({ message: 'to must be a valid ISO 8601 date' })
  to?: Date;
}

export class SendNotificationDto {
  @ApiProperty({ description: 'Who to notify.' })
  @IsString()
  userId!: string;

  @ApiProperty({ enum: NotificationType, default: NotificationType.SYSTEM })
  @IsEnum(NotificationType)
  type!: NotificationType;

  @ApiProperty({ example: 'About your order', maxLength: 160 })
  @IsString()
  @MinLength(3)
  @MaxLength(160)
  @Transform(trim)
  title!: string;

  @ApiProperty({ example: 'Support has replied to your ticket.', maxLength: 1000 })
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  @Transform(trim)
  body!: string;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @IsOptional()
  @IsObject()
  data?: Record<string, unknown>;

  @ApiPropertyOptional({ enum: BROADCAST_CHANNELS, isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsIn(BROADCAST_CHANNELS, { each: true })
  channels?: Array<(typeof BROADCAST_CHANNELS)[number]>;
}
