import { Injectable } from '@nestjs/common';
import { NotificationChannel, NotificationType } from '@prisma/client';

/** A user's stored choice for one category. */
export interface StoredPreference {
  type: NotificationType;
  inApp: boolean;
  push: boolean;
  sms: boolean;
  email: boolean;
}

export interface ChannelSet {
  inApp: boolean;
  push: boolean;
  sms: boolean;
  email: boolean;
}

export interface QuietHours {
  /** Hour of day, 0–23, in the platform's timezone. */
  startHour: number;
  endHour: number;
}

/**
 * Defaults for a user who has never opened the settings screen.
 *
 * Order updates are on everywhere that costs nothing, because a customer who
 * turned nothing on still expects to be told their food is at the door.
 * Promotions are quieter and SMS is off across the board — it costs money per
 * message in this market, and an unsolicited one is worse than no message.
 */
export const DEFAULT_PREFERENCES: Record<NotificationType, ChannelSet> = {
  [NotificationType.ORDER_UPDATE]: { inApp: true, push: true, sms: false, email: false },
  [NotificationType.WALLET]: { inApp: true, push: true, sms: false, email: false },
  [NotificationType.SUPPORT]: { inApp: true, push: true, sms: false, email: false },
  [NotificationType.SYSTEM]: { inApp: true, push: true, sms: false, email: false },
  [NotificationType.PROMOTION]: { inApp: true, push: true, sms: false, email: false },
};

/**
 * Categories that ignore quiet hours.
 *
 * "Your rider is outside" at 3am is exactly the notification somebody wants at
 * 3am. A discount on karahi is not.
 */
export const ALWAYS_DELIVERABLE: NotificationType[] = [
  NotificationType.ORDER_UPDATE,
  NotificationType.SUPPORT,
  NotificationType.WALLET,
];

/**
 * Decides which channels a notification may actually use.
 *
 * Pure, and deliberately the only place this judgement is made: a rule that
 * lives in one function can be read in ten seconds and tested exhaustively,
 * whereas the same rule spread across five senders is how a user who turned
 * promotions off starts receiving promotions from one of them.
 */
@Injectable()
export class PreferenceResolver {
  /**
   * The channels available for a notification, after preferences, defaults and
   * quiet hours.
   *
   * `requested` is what the caller would like to use; the result is never wider
   * than that. A caller asking for push on a category the user muted gets
   * nothing back for push, not an argument.
   */
  resolve(input: {
    type: NotificationType;
    stored: StoredPreference[];
    requested: NotificationChannel[];
    quietHours?: QuietHours | null;
    now?: Date;
  }): NotificationChannel[] {
    const preference = this.effective(input.type, input.stored);
    const quiet = this.inQuietHours(input.type, input.quietHours ?? null, input.now ?? new Date());

    const allowed: Record<NotificationChannel, boolean> = {
      [NotificationChannel.IN_APP]: preference.inApp,
      // Quiet hours silence the channels that make noise. The in-app record is
      // still written, so the message is waiting when the user next looks.
      [NotificationChannel.PUSH]: preference.push && !quiet,
      [NotificationChannel.SMS]: preference.sms && !quiet,
      [NotificationChannel.EMAIL]: preference.email,
    };

    return input.requested.filter((channel) => allowed[channel]);
  }

  /** A user's choice for a category, falling back to the default. */
  effective(type: NotificationType, stored: StoredPreference[]): ChannelSet {
    const match = stored.find((entry) => entry.type === type);

    if (!match) {
      return DEFAULT_PREFERENCES[type];
    }

    return { inApp: match.inApp, push: match.push, sms: match.sms, email: match.email };
  }

  /**
   * Whether this category is currently silenced by quiet hours.
   *
   * The window is allowed to wrap past midnight, because that is the only shape
   * anybody actually configures — 22:00 to 08:00 is a night, not an error.
   */
  inQuietHours(
    type: NotificationType,
    quietHours: QuietHours | null,
    now: Date = new Date(),
  ): boolean {
    if (quietHours === null || ALWAYS_DELIVERABLE.includes(type)) {
      return false;
    }

    const { startHour, endHour } = quietHours;

    if (startHour === endHour) {
      return false;
    }

    const hour = Number(
      new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Karachi',
        hour: '2-digit',
        hour12: false,
      }).format(now),
    );

    return startHour < endHour
      ? hour >= startHour && hour < endHour
      : hour >= startHour || hour < endHour;
  }
}
