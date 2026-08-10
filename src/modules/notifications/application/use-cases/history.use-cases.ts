import { Injectable } from '@nestjs/common';
import { NotificationType } from '@prisma/client';

import { ResourceNotFoundException } from '@/common/exceptions/domain.exception';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import type { PaginatedResult } from '@/common/interfaces/paginated-result.interface';
import { NotificationPreferenceRepository } from '@/modules/users/domain/repositories/notification-preference.repository';

import {
  DeviceTokenRepository,
  NotificationRepository,
} from '../../domain/repositories/notification.repository';
import { PreferenceResolver, type QuietHours } from '../../domain/services/preference-resolver';
import { PushSender } from '../../domain/services/push-sender';
import {
  toNotificationDto,
  type EffectivePreferencesDto,
  type NotificationDto,
  type UnreadCountDto,
} from '../dto/notification-response.dto';
import type { ListNotificationsQueryDto } from '../dto/notification.dto';

/**
 * When promotional pushes are held back.
 *
 * Fixed rather than per-user because it is a courtesy, not a setting: a
 * customer who wants no promotions at all turns the category off, and one who
 * wants them does not want them at 3am either.
 */
export const PROMO_QUIET_HOURS: QuietHours = { startHour: 22, endHour: 8 };

@Injectable()
export class ListNotificationsUseCase {
  constructor(private readonly notifications: NotificationRepository) {}

  async execute(
    actor: AuthenticatedUser,
    query: ListNotificationsQueryDto,
  ): Promise<PaginatedResult<NotificationDto>> {
    const result = await this.notifications.findMany({
      page: query.page,
      limit: query.limit,
      // Always the caller. There is no id a client could pass to read somebody
      // else's notifications, because there is no parameter for it.
      userId: actor.id,
      type: query.type,
      unreadOnly: query.unreadOnly,
      from: query.from,
      to: query.to,
    });

    return { items: result.items.map(toNotificationDto), meta: result.meta };
  }
}

@Injectable()
export class UnreadCountUseCase {
  constructor(private readonly notifications: NotificationRepository) {}

  /**
   * The badge. Called on every app foreground, so it is a grouped count rather
   * than a page of rows nobody renders.
   */
  async execute(actor: AuthenticatedUser): Promise<UnreadCountDto> {
    return this.notifications.unreadSummary(actor.id);
  }
}

@Injectable()
export class MarkReadUseCase {
  constructor(private readonly notifications: NotificationRepository) {}

  async one(actor: AuthenticatedUser, id: string): Promise<NotificationDto> {
    const notification = await this.notifications.markRead(id, actor.id);

    if (notification === null) {
      throw new ResourceNotFoundException('Notification', id);
    }

    return toNotificationDto(notification);
  }

  /** "Mark all read" — the button every notification screen has. */
  async all(actor: AuthenticatedUser): Promise<{ message: string; updated: number }> {
    const updated = await this.notifications.markAllRead(actor.id);

    return { message: `Marked ${updated} notification(s) as read.`, updated };
  }
}

@Injectable()
export class DeleteNotificationUseCase {
  constructor(private readonly notifications: NotificationRepository) {}

  async one(actor: AuthenticatedUser, id: string): Promise<{ message: string }> {
    const deleted = await this.notifications.delete(id, actor.id);

    if (!deleted) {
      throw new ResourceNotFoundException('Notification', id);
    }

    return { message: 'Notification removed.' };
  }

  /**
   * Clears what has been read.
   *
   * Unread ones survive deliberately: "clear" on a notification screen means
   * tidying up, not throwing away a message the user has not seen.
   */
  async read(actor: AuthenticatedUser): Promise<{ message: string; deleted: number }> {
    const deleted = await this.notifications.deleteRead(actor.id);

    return { message: `Cleared ${deleted} read notification(s).`, deleted };
  }
}

@Injectable()
export class EffectivePreferencesUseCase {
  constructor(
    private readonly preferences: NotificationPreferenceRepository,
    private readonly devices: DeviceTokenRepository,
    private readonly resolver: PreferenceResolver,
    private readonly push: PushSender,
  ) {}

  /**
   * What would actually be delivered right now, and why.
   *
   * Distinct from `GET /me/notification-preferences`, which returns the stored
   * choices — this answers the question a settings screen cannot otherwise
   * answer: push is switched on, so why is nothing arriving? The usual answers
   * are no registered device, no Firebase credentials on this deployment, or
   * quiet hours, and none of them are visible from the preference rows alone.
   */
  async execute(
    actor: AuthenticatedUser,
    now: Date = new Date(),
  ): Promise<EffectivePreferencesDto> {
    const [stored, devices] = await Promise.all([
      this.preferences.findForUser(actor.id),
      this.devices.findForUser(actor.id),
    ]);

    const pushConfigured = this.push.isConfigured();
    const hasDevice = devices.length > 0;

    const categories = Object.values(NotificationType).map((type) => {
      const channels = this.resolver.effective(type, stored);
      const quiet = this.resolver.inQuietHours(type, PROMO_QUIET_HOURS, now);

      return {
        type,
        ...channels,
        isDefault: !stored.some((entry) => entry.type === type),
        pushDeliverableNow: channels.push && pushConfigured && hasDevice && !quiet,
      };
    });

    return {
      categories,
      activeDevices: devices.length,
      pushConfigured,
      quietHours: PROMO_QUIET_HOURS,
      inQuietHoursNow: this.resolver.inQuietHours(
        NotificationType.PROMOTION,
        PROMO_QUIET_HOURS,
        now,
      ),
      editAt: 'PATCH /me/notification-preferences',
    };
  }
}
