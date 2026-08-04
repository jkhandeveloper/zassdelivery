import type { NotificationPreference, NotificationType } from '@prisma/client';

export interface PreferenceChannels {
  inApp: boolean;
  push: boolean;
  sms: boolean;
  email: boolean;
}

export abstract class NotificationPreferenceRepository {
  abstract findForUser(userId: string): Promise<NotificationPreference[]>;

  /** Creates or replaces the preference for one category. */
  abstract upsert(
    userId: string,
    type: NotificationType,
    channels: PreferenceChannels,
  ): Promise<NotificationPreference>;

  /** Applies several categories in a single transaction. */
  abstract upsertMany(
    userId: string,
    entries: Array<{ type: NotificationType; channels: PreferenceChannels }>,
  ): Promise<NotificationPreference[]>;

  abstract reset(userId: string): Promise<number>;
}
