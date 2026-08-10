import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  BroadcastAudience,
  BroadcastStatus,
  DevicePlatform,
  NotificationChannel,
  NotificationType,
  UserRole,
  type Broadcast,
  type DeviceToken,
  type Notification,
} from '@prisma/client';

export class NotificationDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: NotificationType }) type!: NotificationType;
  @ApiProperty({ enum: NotificationChannel }) channel!: NotificationChannel;
  @ApiProperty({ example: 'Your order is on the way' }) title!: string;
  @ApiProperty({ example: 'Bilal is 5 minutes away with order ZD-260810-0007.' }) body!: string;
  @ApiPropertyOptional({
    nullable: true,
    type: 'object',
    additionalProperties: true,
    description: 'Deep-link payload for the app to route on.',
  })
  data!: unknown;

  @ApiProperty({ example: false }) isRead!: boolean;
  @ApiPropertyOptional({ nullable: true }) readAt!: Date | null;
  @ApiPropertyOptional({
    nullable: true,
    description: 'Set when a push for this notification reached at least one device.',
  })
  pushSentAt!: Date | null;
  @ApiPropertyOptional({
    nullable: true,
    description: 'Why the push leg failed, when it did. The in-app copy is unaffected.',
  })
  pushError!: string | null;
  @ApiPropertyOptional({ nullable: true, description: 'The campaign this came from, if any.' })
  broadcastId!: string | null;

  @ApiProperty() createdAt!: Date;
}

export class UnreadCountDto {
  @ApiProperty({ example: 7, description: 'The badge number.' }) total!: number;
  @ApiProperty({
    example: [{ type: 'ORDER_UPDATE', count: 5 }],
    description: 'Per category, for the tabs on the notifications screen.',
  })
  byType!: Array<{ type: NotificationType; count: number }>;
}

export class DeviceDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: DevicePlatform }) platform!: DevicePlatform;
  @ApiPropertyOptional({ nullable: true, example: 'Redmi Note 12' }) deviceName!: string | null;
  @ApiPropertyOptional({ nullable: true, example: '1.4.2' }) appVersion!: string | null;
  @ApiProperty({
    example: '…APA91bH',
    description: 'Masked. The full registration token is never returned.',
  })
  token!: string;
  @ApiProperty({ example: true }) isActive!: boolean;
  @ApiPropertyOptional({ nullable: true }) lastError!: string | null;
  @ApiPropertyOptional({ nullable: true }) lastUsedAt!: Date | null;
  @ApiProperty() createdAt!: Date;
}

export class ChannelPreferenceDto {
  @ApiProperty({ enum: NotificationType }) type!: NotificationType;
  @ApiProperty({ example: true }) inApp!: boolean;
  @ApiProperty({ example: true }) push!: boolean;
  @ApiProperty({ example: false }) sms!: boolean;
  @ApiProperty({ example: false }) email!: boolean;
  @ApiProperty({
    example: false,
    description: 'True when this category is using the platform defaults.',
  })
  isDefault!: boolean;
  @ApiProperty({
    example: true,
    description:
      'Whether a push for this category would actually arrive right now — false ' +
      'if the category is muted, no device is registered, or quiet hours are on.',
  })
  pushDeliverableNow!: boolean;
}

export class EffectivePreferencesDto {
  @ApiProperty({ type: [ChannelPreferenceDto] }) categories!: ChannelPreferenceDto[];
  @ApiProperty({ example: 2, description: 'Devices currently able to receive a push.' })
  activeDevices!: number;
  @ApiProperty({
    example: true,
    description: 'Whether this deployment holds Firebase credentials at all.',
  })
  pushConfigured!: boolean;
  @ApiPropertyOptional({
    nullable: true,
    example: { startHour: 22, endHour: 8 },
    description:
      'Window during which promotional pushes are held back. Order, wallet and ' +
      'support messages ignore it — "your rider is outside" at 3am is exactly ' +
      'what somebody wants at 3am.',
  })
  quietHours!: { startHour: number; endHour: number } | null;
  @ApiProperty({ example: false, description: 'Whether quiet hours are in force right now.' })
  inQuietHoursNow!: boolean;

  @ApiProperty({
    example: 'PATCH /me/notification-preferences',
    description: 'Where these choices are edited.',
  })
  editAt!: string;
}

export class BroadcastDto {
  @ApiProperty() id!: string;
  @ApiProperty({ example: '30% off at Chapli Kabab House tonight' }) title!: string;
  @ApiProperty() body!: string;
  @ApiProperty({ enum: NotificationType }) type!: NotificationType;
  @ApiProperty({ enum: BroadcastAudience }) audience!: BroadcastAudience;
  @ApiPropertyOptional({ nullable: true, enum: UserRole }) roleFilter!: UserRole | null;
  @ApiPropertyOptional({ nullable: true }) zoneId!: string | null;
  @ApiProperty({ enum: NotificationChannel, isArray: true }) channels!: NotificationChannel[];
  @ApiProperty({ enum: BroadcastStatus }) status!: BroadcastStatus;

  @ApiProperty({ example: 1240, description: 'Recipients the audience resolved to.' })
  recipientCount!: number;
  @ApiProperty({ example: 1187 }) deliveredCount!: number;
  @ApiProperty({ example: 12 }) failedCount!: number;
  @ApiProperty({
    example: 41,
    description: 'Recipients whose own preferences ruled them out. Not a failure.',
  })
  skippedCount!: number;

  @ApiPropertyOptional({ nullable: true }) scheduledFor!: Date | null;
  @ApiPropertyOptional({ nullable: true }) startedAt!: Date | null;
  @ApiPropertyOptional({ nullable: true }) completedAt!: Date | null;
  @ApiPropertyOptional({ nullable: true }) error!: string | null;
  @ApiProperty() createdAt!: Date;
}

export class BroadcastPreviewDto {
  @ApiProperty({ example: 1240, description: 'How many accounts this audience matches.' })
  recipientCount!: number;
  @ApiProperty({ enum: BroadcastAudience }) audience!: BroadcastAudience;
  @ApiProperty({
    example: 'All active accounts',
    description: 'The audience in words, so nobody sends to 40,000 people by accident.',
  })
  description!: string;
}

export class SendResultDto {
  @ApiProperty({ example: 'Sent to 1187 of 1240 recipients.' }) message!: string;
  @ApiProperty({ example: 1187 }) delivered!: number;
  @ApiProperty({ example: 12 }) failed!: number;
  @ApiProperty({ example: 41 }) skipped!: number;
}

// ── Mappers ────────────────────────────────────────────────────

/**
 * Registration tokens are long-lived credentials for pushing to a device.
 * Nothing in the product needs one back, so a device is identified by its tail.
 */
function maskToken(token: string): string {
  return token.length <= 8 ? '•'.repeat(token.length) : `…${token.slice(-8)}`;
}

export function toNotificationDto(notification: Notification): NotificationDto {
  return {
    id: notification.id,
    type: notification.type,
    channel: notification.channel,
    title: notification.title,
    body: notification.body,
    data: notification.data,
    isRead: notification.isRead,
    readAt: notification.readAt,
    pushSentAt: notification.pushSentAt,
    pushError: notification.pushError,
    broadcastId: notification.broadcastId,
    createdAt: notification.createdAt,
  };
}

export function toDeviceDto(device: DeviceToken): DeviceDto {
  return {
    id: device.id,
    platform: device.platform,
    deviceName: device.deviceName,
    appVersion: device.appVersion,
    token: maskToken(device.token),
    isActive: device.isActive,
    lastError: device.lastError,
    lastUsedAt: device.lastUsedAt,
    createdAt: device.createdAt,
  };
}

export function toBroadcastDto(broadcast: Broadcast): BroadcastDto {
  return {
    id: broadcast.id,
    title: broadcast.title,
    body: broadcast.body,
    type: broadcast.type,
    audience: broadcast.audience,
    roleFilter: broadcast.roleFilter,
    zoneId: broadcast.zoneId,
    channels: broadcast.channels,
    status: broadcast.status,
    recipientCount: broadcast.recipientCount,
    deliveredCount: broadcast.deliveredCount,
    failedCount: broadcast.failedCount,
    skippedCount: broadcast.skippedCount,
    scheduledFor: broadcast.scheduledFor,
    startedAt: broadcast.startedAt,
    completedAt: broadcast.completedAt,
    error: broadcast.error,
    createdAt: broadcast.createdAt,
  };
}
