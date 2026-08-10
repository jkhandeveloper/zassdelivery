import { Inject, Injectable, type LoggerService } from '@nestjs/common';
import { NotificationChannel, NotificationType } from '@prisma/client';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import type { ConfigType } from '@nestjs/config';
import type { Prisma } from '@prisma/client';

import { notificationsConfig } from '@/config';
import { NotificationPreferenceRepository } from '@/modules/users/domain/repositories/notification-preference.repository';

import {
  DeviceTokenRepository,
  NotificationRepository,
} from '../../domain/repositories/notification.repository';
import { PreferenceResolver, type QuietHours } from '../../domain/services/preference-resolver';
import { PushSender, type PushMessage } from '../../domain/services/push-sender';

export interface NotifyInput {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  /** Deep-link payload. Flattened to strings before it reaches the device. */
  data?: Record<string, unknown> | null;
  /** Channels to try. Narrowed by the user's own preferences before anything sends. */
  channels?: NotificationChannel[];
  broadcastId?: string | null;
  /** Quiet hours to honour for this send, when the caller knows them. */
  quietHours?: QuietHours | null;
}

export interface NotifyResult {
  notificationId: string | null;
  /** What survived the preference check. Empty means the user opted out. */
  channels: NotificationChannel[];
  pushDelivered: number;
  pushFailed: number;
  skipped: boolean;
}

/** Categories urgent enough to wake a phone rather than wait for an unlock. */
const HIGH_PRIORITY_TYPES: NotificationType[] = [
  NotificationType.ORDER_UPDATE,
  NotificationType.SUPPORT,
];

const DEFAULT_CHANNELS: NotificationChannel[] = [
  NotificationChannel.IN_APP,
  NotificationChannel.PUSH,
];

/**
 * The one way anything reaches a user.
 *
 * Every module that needs to tell somebody something calls this rather than
 * writing notification rows or talking to Firebase — which is what makes
 * preferences meaningful. A preference honoured by four of five senders is not
 * a preference, and the fifth is always the one a complaint is about.
 *
 * Notifications are best-effort by design: a push that fails must never fail
 * the delivery, the order or the refund that prompted it. The caller's work has
 * already happened; a lost message is a support ticket, a rolled-back
 * transaction is a disaster.
 */
@Injectable()
export class NotifyService {
  private readonly context = NotifyService.name;

  constructor(
    private readonly notifications: NotificationRepository,
    private readonly devices: DeviceTokenRepository,
    private readonly preferences: NotificationPreferenceRepository,
    private readonly resolver: PreferenceResolver,
    private readonly push: PushSender,
    @Inject(notificationsConfig.KEY)
    private readonly config: ConfigType<typeof notificationsConfig>,
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: LoggerService,
  ) {}

  /** Sends to one user, on whichever channels they allow. */
  async notify(input: NotifyInput): Promise<NotifyResult> {
    const stored = await this.preferences.findForUser(input.userId);

    const channels = this.resolver.resolve({
      type: input.type,
      stored,
      requested: input.channels ?? DEFAULT_CHANNELS,
      quietHours: input.quietHours ?? null,
    });

    if (channels.length === 0) {
      return {
        notificationId: null,
        channels: [],
        pushDelivered: 0,
        pushFailed: 0,
        skipped: true,
      };
    }

    const data = this.flatten(input.data);

    // The in-app row is written first and is the record that matters: it is
    // what the history screen shows, and it survives a push that never lands.
    const notification = channels.includes(NotificationChannel.IN_APP)
      ? await this.notifications.create({
          userId: input.userId,
          type: input.type,
          channel: NotificationChannel.IN_APP,
          title: input.title,
          body: input.body,
          data: (input.data ?? null) as Prisma.InputJsonValue | null,
          broadcastId: input.broadcastId ?? null,
        })
      : null;

    if (!channels.includes(NotificationChannel.PUSH)) {
      return {
        notificationId: notification?.id ?? null,
        channels,
        pushDelivered: 0,
        pushFailed: 0,
        skipped: false,
      };
    }

    const outcome = await this.pushToUser(input, data);

    if (notification !== null) {
      await this.notifications.recordPushResult(notification.id, {
        deliveredAt: outcome.delivered > 0 ? new Date() : null,
        error: outcome.error,
      });
    }

    return {
      notificationId: notification?.id ?? null,
      channels,
      pushDelivered: outcome.delivered,
      pushFailed: outcome.failed,
      skipped: false,
    };
  }

  /**
   * Sends to many users at once, for a broadcast.
   *
   * Preferences are read for the whole batch and the in-app rows are written in
   * one statement, because a campaign that issues four queries per recipient is
   * a campaign that takes an afternoon.
   */
  async notifyMany(
    userIds: string[],
    template: Omit<NotifyInput, 'userId'>,
  ): Promise<{ delivered: number; failed: number; skipped: number }> {
    if (userIds.length === 0) {
      return { delivered: 0, failed: 0, skipped: 0 };
    }

    const requested = template.channels ?? DEFAULT_CHANNELS;
    const data = this.flatten(template.data);

    const allowed = await Promise.all(
      userIds.map(async (userId) => ({
        userId,
        channels: this.resolver.resolve({
          type: template.type,
          stored: await this.preferences.findForUser(userId),
          requested,
          quietHours: template.quietHours ?? null,
        }),
      })),
    );

    const inApp = allowed.filter((entry) => entry.channels.includes(NotificationChannel.IN_APP));
    const pushable = allowed.filter((entry) => entry.channels.includes(NotificationChannel.PUSH));
    const skipped = allowed.filter((entry) => entry.channels.length === 0).length;

    if (inApp.length > 0) {
      await this.notifications.createMany(
        inApp.map((entry) => ({
          userId: entry.userId,
          type: template.type,
          channel: NotificationChannel.IN_APP,
          title: template.title,
          body: template.body,
          data: (template.data ?? null) as Prisma.InputJsonValue | null,
          broadcastId: template.broadcastId ?? null,
        })),
      );
    }

    if (pushable.length === 0) {
      return { delivered: inApp.length, failed: 0, skipped };
    }

    const tokens = await this.devices.findActiveForUsers(pushable.map((entry) => entry.userId));

    if (tokens.length === 0 || !this.push.isConfigured()) {
      return { delivered: inApp.length, failed: 0, skipped };
    }

    const outcomes = await this.push.sendMany(
      tokens.map((device) => ({
        token: device.token,
        title: template.title,
        body: template.body,
        data,
        highPriority: HIGH_PRIORITY_TYPES.includes(template.type),
      })),
    );

    await this.reconcileTokens(outcomes);

    const pushDelivered = outcomes.filter((outcome) => outcome.delivered).length;

    return {
      // A recipient counts as reached if either leg worked. An in-app message
      // sitting in their history is a message they will see.
      delivered: Math.max(inApp.length, pushDelivered),
      failed: outcomes.length - pushDelivered,
      skipped,
    };
  }

  private async pushToUser(
    input: NotifyInput,
    data: Record<string, string>,
  ): Promise<{ delivered: number; failed: number; error: string | null }> {
    if (!this.push.isConfigured()) {
      return { delivered: 0, failed: 0, error: null };
    }

    const devices = await this.devices.findForUser(input.userId);

    if (devices.length === 0) {
      // Not a failure. A user with push enabled and no registered device has
      // simply not opened the app on a phone yet.
      return { delivered: 0, failed: 0, error: null };
    }

    const messages: PushMessage[] = devices.map((device) => ({
      token: device.token,
      title: input.title,
      body: input.body,
      data,
      highPriority: HIGH_PRIORITY_TYPES.includes(input.type),
    }));

    const outcomes = await this.push.sendMany(messages);
    await this.reconcileTokens(outcomes);

    const delivered = outcomes.filter((outcome) => outcome.delivered).length;
    const firstError = outcomes.find((outcome) => !outcome.delivered)?.error ?? null;

    if (delivered === 0 && firstError !== null) {
      this.logger.warn?.(`Push to ${input.userId} reached no device: ${firstError}`, this.context);
    }

    return {
      delivered,
      failed: outcomes.length - delivered,
      error: delivered > 0 ? null : firstError,
    };
  }

  /**
   * Keeps the device list honest after a send.
   *
   * A token Firebase has declared dead is retired at once; a token that merely
   * failed gets a strike. Without this the fan-out grows a tail of uninstalled
   * apps that every future broadcast pays for.
   */
  private async reconcileTokens(
    outcomes: Array<{
      token: string;
      delivered: boolean;
      error: string | null;
      tokenIsDead: boolean;
    }>,
  ): Promise<void> {
    await Promise.all(
      outcomes.map(async (outcome) => {
        try {
          if (outcome.delivered) {
            await this.devices.recordSuccess(outcome.token);
          } else if (outcome.tokenIsDead) {
            await this.devices.deactivate(outcome.token);
          } else {
            await this.devices.recordFailure(
              outcome.token,
              outcome.error ?? 'Unknown push failure',
              this.config.maxPushFailures,
            );
          }
        } catch {
          // Token bookkeeping must never be the thing that fails a send. The
          // worst case is one stale row, which the next send corrects.
        }
      }),
    );
  }

  /**
   * FCM requires every data value to be a string.
   *
   * A number or a nested object here fails the entire message rather than the
   * one field, which is a miserable thing to debug from a phone that simply
   * received nothing.
   */
  private flatten(data: Record<string, unknown> | null | undefined): Record<string, string> {
    if (data === null || data === undefined) {
      return {};
    }

    const flat: Record<string, string> = {};

    for (const [key, value] of Object.entries(data)) {
      if (value === null || value === undefined) {
        continue;
      }

      // Objects are serialised rather than coerced: `String({})` produces
      // "[object Object]", which reaches the phone as a value nobody can use.
      if (typeof value === 'object') {
        flat[key] = JSON.stringify(value);
      } else if (typeof value === 'string') {
        flat[key] = value;
      } else if (typeof value === 'number' || typeof value === 'boolean') {
        flat[key] = String(value);
      }
    }

    return flat;
  }
}
