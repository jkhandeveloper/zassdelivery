import { Injectable } from '@nestjs/common';
import { NotificationType } from '@prisma/client';

import {
  ResourceConflictException,
  ResourceNotFoundException,
} from '@/common/exceptions/domain.exception';

import { NotificationPreferenceRepository } from '../../domain/repositories/notification-preference.repository';
import { UserRepository } from '../../domain/repositories/user.repository';
import type {
  NotificationPreferenceDto,
  UpdateNotificationPreferencesDto,
} from '../dto/notification-preference.dto';
import type { UpdateProfileDto } from '../dto/user.dto';
import { toUserDto, type UserDto } from '../dto/user-response.dto';

/**
 * Channel defaults per category, applied when a user has never customised one.
 *
 * Order updates are the only category that may reach for SMS: they are
 * transactional and time-critical. Marketing over SMS without an explicit
 * opt-in is both costly and a good way to get a sender ID blocked.
 */
const DEFAULT_CHANNELS: Record<
  NotificationType,
  { inApp: boolean; push: boolean; sms: boolean; email: boolean }
> = {
  [NotificationType.ORDER_UPDATE]: { inApp: true, push: true, sms: true, email: false },
  [NotificationType.WALLET]: { inApp: true, push: true, sms: false, email: false },
  [NotificationType.SUPPORT]: { inApp: true, push: true, sms: false, email: true },
  [NotificationType.SYSTEM]: { inApp: true, push: true, sms: false, email: false },
  [NotificationType.PROMOTION]: { inApp: true, push: false, sms: false, email: false },
};

@Injectable()
export class GetProfileUseCase {
  constructor(private readonly users: UserRepository) {}

  async execute(userId: string): Promise<UserDto> {
    const user = await this.users.findById(userId);

    if (!user) {
      throw new ResourceNotFoundException('User', userId);
    }

    return toUserDto(user);
  }
}

@Injectable()
export class UpdateProfileUseCase {
  constructor(private readonly users: UserRepository) {}

  async execute(userId: string, dto: UpdateProfileDto): Promise<UserDto> {
    const user = await this.users.findById(userId);

    if (!user) {
      throw new ResourceNotFoundException('User', userId);
    }

    if (dto.email && (await this.users.existsByEmail(dto.email, userId))) {
      throw new ResourceConflictException('An account with this email address already exists.');
    }

    // Phone, role and status are absent from UpdateProfileDto by design: the
    // phone is the login identity and changing it needs re-verification, and
    // the other two are privilege decisions that belong to an administrator.
    return toUserDto(await this.users.update(userId, dto));
  }
}

@Injectable()
export class GetNotificationPreferencesUseCase {
  constructor(private readonly preferences: NotificationPreferenceRepository) {}

  /**
   * Returns every category, merging stored rows over the defaults, so a client
   * can render the full settings screen from one response without knowing which
   * categories happen to have been saved.
   */
  async execute(userId: string): Promise<NotificationPreferenceDto[]> {
    const stored = await this.preferences.findForUser(userId);
    const byType = new Map(stored.map((row) => [row.type, row]));

    return Object.values(NotificationType).map((type) => {
      const row = byType.get(type);
      const defaults = DEFAULT_CHANNELS[type];

      return {
        type,
        inApp: row?.inApp ?? defaults.inApp,
        push: row?.push ?? defaults.push,
        sms: row?.sms ?? defaults.sms,
        email: row?.email ?? defaults.email,
        isCustomised: row !== undefined,
      };
    });
  }
}

@Injectable()
export class UpdateNotificationPreferencesUseCase {
  constructor(
    private readonly preferences: NotificationPreferenceRepository,
    private readonly getPreferences: GetNotificationPreferencesUseCase,
  ) {}

  async execute(
    userId: string,
    dto: UpdateNotificationPreferencesDto,
  ): Promise<NotificationPreferenceDto[]> {
    const entries = dto.preferences.map((entry) => {
      const defaults = DEFAULT_CHANNELS[entry.type];

      return {
        type: entry.type,
        channels: {
          // Undefined means "leave as the default", not "turn off" — a client
          // sending only { type, sms: true } must not silently disable push.
          inApp: entry.inApp ?? defaults.inApp,
          push: entry.push ?? defaults.push,
          sms: entry.sms ?? defaults.sms,
          email: entry.email ?? defaults.email,
        },
      };
    });

    await this.preferences.upsertMany(userId, entries);

    return this.getPreferences.execute(userId);
  }
}

@Injectable()
export class ResetNotificationPreferencesUseCase {
  constructor(
    private readonly preferences: NotificationPreferenceRepository,
    private readonly getPreferences: GetNotificationPreferencesUseCase,
  ) {}

  async execute(userId: string): Promise<NotificationPreferenceDto[]> {
    // Deleting the rows restores the defaults, since a missing row *is* the
    // default. No back-fill required.
    await this.preferences.reset(userId);
    return this.getPreferences.execute(userId);
  }
}
