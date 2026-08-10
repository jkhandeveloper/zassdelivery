import { Module } from '@nestjs/common';

import { RealtimeModule } from '../realtime/realtime.module';
import { UsersModule } from '../users/users.module';
import {
  CancelBroadcastUseCase,
  CreateBroadcastUseCase,
  DispatchScheduledBroadcastsUseCase,
  GetBroadcastUseCase,
  ListBroadcastsUseCase,
  PreviewAudienceUseCase,
  SendBroadcastUseCase,
  SendDirectNotificationUseCase,
  UpdateBroadcastUseCase,
} from './application/use-cases/broadcast.use-cases';
import {
  ListDevicesUseCase,
  RegisterDeviceUseCase,
  SendTestPushUseCase,
  UnregisterAllDevicesUseCase,
  UnregisterDeviceUseCase,
} from './application/use-cases/device.use-cases';
import {
  DeleteNotificationUseCase,
  EffectivePreferencesUseCase,
  ListNotificationsUseCase,
  MarkReadUseCase,
  UnreadCountUseCase,
} from './application/use-cases/history.use-cases';
import { NotifyService } from './application/use-cases/notify.service';
import {
  BroadcastRepository,
  DeviceTokenRepository,
  NotificationRepository,
} from './domain/repositories/notification.repository';
import { PreferenceResolver } from './domain/services/preference-resolver';
import { PushSender } from './domain/services/push-sender';
import { NotificationManagementController } from './notification-management.controller';
import { NotificationsController } from './notifications.controller';
import { FcmSender } from './infrastructure/push/fcm.sender';
import { PrismaBroadcastRepository } from './infrastructure/repositories/prisma-broadcast.repository';
import { PrismaDeviceTokenRepository } from './infrastructure/repositories/prisma-device-token.repository';
import { PrismaNotificationRepository } from './infrastructure/repositories/prisma-notification.repository';

@Module({
  // UsersModule supplies NotificationPreferenceRepository: the preference
  // matrix belongs to a user's profile and is edited there, while every
  // decision to honour it is made here. RealtimeModule delivers the same
  // notification to a connected client immediately.
  imports: [UsersModule, RealtimeModule],
  controllers: [NotificationsController, NotificationManagementController],
  providers: [
    // Pure domain service: no dependencies, registered directly.
    PreferenceResolver,

    NotifyService,

    ListNotificationsUseCase,
    UnreadCountUseCase,
    MarkReadUseCase,
    DeleteNotificationUseCase,
    EffectivePreferencesUseCase,

    RegisterDeviceUseCase,
    ListDevicesUseCase,
    UnregisterDeviceUseCase,
    UnregisterAllDevicesUseCase,
    SendTestPushUseCase,

    CreateBroadcastUseCase,
    UpdateBroadcastUseCase,
    ListBroadcastsUseCase,
    GetBroadcastUseCase,
    PreviewAudienceUseCase,
    SendBroadcastUseCase,
    CancelBroadcastUseCase,
    DispatchScheduledBroadcastsUseCase,
    SendDirectNotificationUseCase,

    { provide: PushSender, useClass: FcmSender },
    { provide: NotificationRepository, useClass: PrismaNotificationRepository },
    { provide: DeviceTokenRepository, useClass: PrismaDeviceTokenRepository },
    { provide: BroadcastRepository, useClass: PrismaBroadcastRepository },
  ],
  // NotifyService is the one way anything reaches a user, so every module that
  // needs to tell somebody something imports this rather than writing
  // notification rows of its own.
  exports: [NotifyService, NotificationRepository, DeviceTokenRepository],
})
export class NotificationsModule {}
