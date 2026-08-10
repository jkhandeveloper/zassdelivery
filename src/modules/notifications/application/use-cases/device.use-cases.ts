import { Injectable } from '@nestjs/common';
import { NotificationType } from '@prisma/client';

import { BusinessRuleViolationException } from '@/common/exceptions/domain.exception';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';

import { DeviceTokenRepository } from '../../domain/repositories/notification.repository';
import { PushSender } from '../../domain/services/push-sender';
import { toDeviceDto, type DeviceDto } from '../dto/notification-response.dto';
import type { RegisterDeviceDto, TestPushDto, UnregisterDeviceDto } from '../dto/notification.dto';
import { NotifyService } from './notify.service';

@Injectable()
export class RegisterDeviceUseCase {
  constructor(private readonly devices: DeviceTokenRepository) {}

  /**
   * Registers the phone in front of the user.
   *
   * Called on every app start, not just the first: Firebase rotates tokens on
   * its own schedule, and an app that only registers once eventually holds a
   * token the platform has never heard of.
   */
  async execute(actor: AuthenticatedUser, dto: RegisterDeviceDto): Promise<DeviceDto> {
    const device = await this.devices.register({
      userId: actor.id,
      token: dto.token,
      platform: dto.platform,
      deviceId: dto.deviceId ?? null,
      deviceName: dto.deviceName ?? null,
      appVersion: dto.appVersion ?? null,
    });

    return toDeviceDto(device);
  }
}

@Injectable()
export class ListDevicesUseCase {
  constructor(private readonly devices: DeviceTokenRepository) {}

  /** The user's registered devices, so they can see what is receiving pushes. */
  async execute(actor: AuthenticatedUser): Promise<DeviceDto[]> {
    const devices = await this.devices.findForUser(actor.id, false);

    return devices.map(toDeviceDto);
  }
}

@Injectable()
export class UnregisterDeviceUseCase {
  constructor(private readonly devices: DeviceTokenRepository) {}

  /**
   * Stops pushing to one device — what an app calls on sign-out.
   *
   * Scoped to the caller: a token is an address, and being able to silence one
   * by guessing it would be a way to cut somebody else off from their order
   * updates.
   */
  async execute(actor: AuthenticatedUser, dto: UnregisterDeviceDto): Promise<{ message: string }> {
    const removed = await this.devices.deactivateForUser(actor.id, dto.token);

    return {
      message: removed
        ? 'This device will no longer receive notifications.'
        : 'That device was not registered to you, or was already signed out.',
    };
  }
}

@Injectable()
export class UnregisterAllDevicesUseCase {
  constructor(private readonly devices: DeviceTokenRepository) {}

  async execute(actor: AuthenticatedUser): Promise<{ message: string; devices: number }> {
    const count = await this.devices.deactivateAllForUser(actor.id);

    return { message: `Stopped notifications on ${count} device(s).`, devices: count };
  }
}

@Injectable()
export class SendTestPushUseCase {
  constructor(
    private readonly notify: NotifyService,
    private readonly devices: DeviceTokenRepository,
    private readonly push: PushSender,
  ) {}

  /**
   * Sends the caller a push, to prove the whole chain works.
   *
   * The single most useful endpoint in this module during an integration: it
   * answers "is it the token, the credentials, the preferences or the phone"
   * without anyone having to place a real order to find out.
   */
  async execute(actor: AuthenticatedUser, dto: TestPushDto) {
    if (!this.push.isConfigured()) {
      throw new BusinessRuleViolationException(
        'Push is not configured on this deployment, so there is nothing to test.',
      );
    }

    const devices = await this.devices.findForUser(actor.id);

    if (devices.length === 0) {
      throw new BusinessRuleViolationException(
        'No device is registered for your account. Open the app and allow notifications first.',
      );
    }

    const result = await this.notify.notify({
      userId: actor.id,
      type: NotificationType.SYSTEM,
      title: 'ZassDelivery test notification',
      body: dto.message ?? 'If you can read this, push notifications are working.',
      data: { kind: 'test' },
    });

    return {
      message:
        result.pushDelivered > 0
          ? `Sent to ${result.pushDelivered} of ${devices.length} device(s).`
          : 'No device accepted the push. Check the devices list for the last error.',
      devices: devices.length,
      delivered: result.pushDelivered,
      failed: result.pushFailed,
    };
  }
}
