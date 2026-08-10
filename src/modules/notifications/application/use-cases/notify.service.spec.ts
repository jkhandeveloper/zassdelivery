import { NotificationChannel, NotificationType } from '@prisma/client';
import type { LoggerService } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';

import type { notificationsConfig } from '@/config';
import type { RealtimeService } from '@/modules/realtime/application/realtime.service';
import type { NotificationPreferenceRepository } from '@/modules/users/domain/repositories/notification-preference.repository';

import type {
  DeviceTokenRepository,
  NotificationRepository,
} from '../../domain/repositories/notification.repository';
import { PreferenceResolver } from '../../domain/services/preference-resolver';
import type { PushOutcome, PushSender } from '../../domain/services/push-sender';
import { NotifyService } from './notify.service';

const logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() } as unknown as LoggerService;

const CONFIG = {
  pushConcurrency: 25,
  broadcastBatchSize: 500,
  maxPushFailures: 5,
} as ConfigType<typeof notificationsConfig>;

function outcome(token: string, overrides: Partial<PushOutcome> = {}): PushOutcome {
  return {
    token,
    delivered: true,
    messageId: 'projects/zass/messages/1',
    error: null,
    tokenIsDead: false,
    ...overrides,
  };
}

function build(options: {
  stored?: Array<Record<string, unknown>>;
  devices?: Array<{ token: string }>;
  outcomes?: PushOutcome[];
  pushConfigured?: boolean;
}) {
  const notifications = {
    create: jest.fn().mockResolvedValue({
      id: 'notification-1',
      type: NotificationType.ORDER_UPDATE,
      title: 'Your order is on the way',
      body: 'Bilal is 5 minutes away.',
      createdAt: new Date(),
    }),
    createMany: jest.fn().mockResolvedValue(0),
    recordPushResult: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<NotificationRepository>;

  const devices = {
    findForUser: jest.fn().mockResolvedValue(options.devices ?? [{ token: 'device-a' }]),
    findActiveForUsers: jest.fn().mockResolvedValue(options.devices ?? [{ token: 'device-a' }]),
    recordSuccess: jest.fn().mockResolvedValue(undefined),
    recordFailure: jest.fn().mockResolvedValue(undefined),
    deactivate: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<DeviceTokenRepository>;

  const preferences = {
    findForUser: jest.fn().mockResolvedValue(options.stored ?? []),
  } as unknown as jest.Mocked<NotificationPreferenceRepository>;

  const push = {
    name: 'fcm',
    isConfigured: jest.fn().mockReturnValue(options.pushConfigured ?? true),
    sendMany: jest.fn().mockResolvedValue(options.outcomes ?? [outcome('device-a')]),
  } as unknown as jest.Mocked<PushSender>;

  const realtime = { notificationCreated: jest.fn() } as unknown as jest.Mocked<RealtimeService>;

  return {
    notifications,
    devices,
    preferences,
    push,
    realtime,
    service: new NotifyService(
      notifications,
      devices,
      preferences,
      new PreferenceResolver(),
      push,
      realtime,
      CONFIG,
      logger,
    ),
  };
}

const MESSAGE = {
  userId: 'user-1',
  type: NotificationType.ORDER_UPDATE,
  title: 'Your order is on the way',
  body: 'Bilal is 5 minutes away.',
};

describe('NotifyService.notify', () => {
  it('writes the in-app record and sends a push', async () => {
    const { service, notifications, push } = build({});

    const result = await service.notify(MESSAGE);

    expect(notifications.create).toHaveBeenCalled();
    expect(push.sendMany).toHaveBeenCalled();
    expect(result.channels).toEqual([NotificationChannel.IN_APP, NotificationChannel.PUSH]);
    expect(result.pushDelivered).toBe(1);
  });

  it('sends nothing when the user muted the category', async () => {
    const { service, notifications, push } = build({
      stored: [
        {
          type: NotificationType.ORDER_UPDATE,
          inApp: false,
          push: false,
          sms: false,
          email: false,
        },
      ],
    });

    const result = await service.notify(MESSAGE);

    expect(notifications.create).not.toHaveBeenCalled();
    expect(push.sendMany).not.toHaveBeenCalled();
    expect(result.skipped).toBe(true);
  });

  it('still writes the in-app record when only push is muted', async () => {
    const { service, notifications, push } = build({
      stored: [
        { type: NotificationType.ORDER_UPDATE, inApp: true, push: false, sms: false, email: false },
      ],
    });

    const result = await service.notify(MESSAGE);

    expect(notifications.create).toHaveBeenCalled();
    expect(push.sendMany).not.toHaveBeenCalled();
    expect(result.channels).toEqual([NotificationChannel.IN_APP]);
  });

  it('records the push outcome against the notification', async () => {
    const { service, notifications } = build({});

    await service.notify(MESSAGE);

    expect(notifications.recordPushResult).toHaveBeenCalledWith(
      'notification-1',
      expect.objectContaining({ deliveredAt: expect.any(Date), error: null }),
    );
  });

  it('records why a push failed, leaving the in-app copy intact', async () => {
    const { service, notifications } = build({
      outcomes: [outcome('device-a', { delivered: false, error: 'Device offline' })],
    });

    const result = await service.notify(MESSAGE);

    expect(notifications.create).toHaveBeenCalled();
    expect(notifications.recordPushResult).toHaveBeenCalledWith('notification-1', {
      deliveredAt: null,
      error: 'Device offline',
    });
    expect(result.pushFailed).toBe(1);
  });

  it('is not a failure when the user simply has no registered device', async () => {
    const { service, push } = build({ devices: [] });

    const result = await service.notify(MESSAGE);

    expect(push.sendMany).not.toHaveBeenCalled();
    expect(result.pushDelivered).toBe(0);
    expect(result.skipped).toBe(false);
  });

  it('skips the push leg entirely when push is unconfigured', async () => {
    const { service, notifications, push } = build({ pushConfigured: false });

    await service.notify(MESSAGE);

    expect(notifications.create).toHaveBeenCalled();
    expect(push.sendMany).not.toHaveBeenCalled();
  });

  it('sends to every registered device, not just the newest', async () => {
    const { service, push } = build({
      devices: [{ token: 'phone' }, { token: 'tablet' }],
      outcomes: [outcome('phone'), outcome('tablet')],
    });

    await service.notify(MESSAGE);

    expect((push.sendMany as jest.Mock).mock.calls[0][0]).toHaveLength(2);
  });

  it('wakes the phone for an order update but not for a promotion', async () => {
    const urgent = build({});
    await urgent.service.notify(MESSAGE);
    expect((urgent.push.sendMany as jest.Mock).mock.calls[0][0][0].highPriority).toBe(true);

    const promo = build({});
    await promo.service.notify({ ...MESSAGE, type: NotificationType.PROMOTION });
    expect((promo.push.sendMany as jest.Mock).mock.calls[0][0][0].highPriority).toBe(false);
  });
});

describe('NotifyService — data payloads', () => {
  it('stringifies every data value, because FCM rejects anything else', async () => {
    const { service, push } = build({});

    await service.notify({
      ...MESSAGE,
      data: { orderId: 'order-1', attempt: 2, nested: { screen: 'order' }, missing: null },
    });

    expect((push.sendMany as jest.Mock).mock.calls[0][0][0].data).toEqual({
      orderId: 'order-1',
      attempt: '2',
      nested: '{"screen":"order"}',
    });
  });

  it('sends an empty payload rather than undefined when there is no data', async () => {
    const { service, push } = build({});

    await service.notify(MESSAGE);

    expect((push.sendMany as jest.Mock).mock.calls[0][0][0].data).toEqual({});
  });
});

describe('NotifyService — device hygiene', () => {
  it('retires a token Firebase says is dead', async () => {
    const { service, devices } = build({
      outcomes: [
        outcome('device-a', { delivered: false, error: 'UNREGISTERED', tokenIsDead: true }),
      ],
    });

    await service.notify(MESSAGE);

    expect(devices.deactivate).toHaveBeenCalledWith('device-a');
    expect(devices.recordFailure).not.toHaveBeenCalled();
  });

  it('only counts a strike against a token that merely failed', async () => {
    const { service, devices } = build({
      outcomes: [outcome('device-a', { delivered: false, error: 'timeout' })],
    });

    await service.notify(MESSAGE);

    // A bad night should not cost a customer their notifications.
    expect(devices.deactivate).not.toHaveBeenCalled();
    expect(devices.recordFailure).toHaveBeenCalledWith('device-a', 'timeout', 5);
  });

  it('clears the strike count on a success', async () => {
    const { service, devices } = build({});

    await service.notify(MESSAGE);

    expect(devices.recordSuccess).toHaveBeenCalledWith('device-a');
  });

  it('does not let token bookkeeping failures break the send', async () => {
    const { service, devices } = build({});
    (devices.recordSuccess as jest.Mock).mockRejectedValue(new Error('database busy'));

    await expect(service.notify(MESSAGE)).resolves.toMatchObject({ pushDelivered: 1 });
  });
});

describe('NotifyService.notifyMany', () => {
  it('writes the in-app rows in one statement', async () => {
    const { service, notifications } = build({});

    await service.notifyMany(['user-1', 'user-2', 'user-3'], MESSAGE);

    expect(notifications.createMany).toHaveBeenCalledTimes(1);
    expect((notifications.createMany as jest.Mock).mock.calls[0][0]).toHaveLength(3);
  });

  it('counts opt-outs as skipped rather than failed', async () => {
    const { service, preferences } = build({});
    (preferences.findForUser as jest.Mock).mockImplementation((userId: string) =>
      Promise.resolve(
        userId === 'user-2'
          ? [
              {
                type: NotificationType.ORDER_UPDATE,
                inApp: false,
                push: false,
                sms: false,
                email: false,
              },
            ]
          : [],
      ),
    );

    const result = await service.notifyMany(['user-1', 'user-2'], MESSAGE);

    expect(result.skipped).toBe(1);
    expect(result.failed).toBe(0);
  });

  it('does nothing at all for an empty recipient list', async () => {
    const { service, notifications, push } = build({});

    const result = await service.notifyMany([], MESSAGE);

    expect(notifications.createMany).not.toHaveBeenCalled();
    expect(push.sendMany).not.toHaveBeenCalled();
    expect(result).toEqual({ delivered: 0, failed: 0, skipped: 0 });
  });

  it('still records in-app messages when nobody has a device', async () => {
    const { service, notifications } = build({ devices: [] });

    const result = await service.notifyMany(['user-1', 'user-2'], MESSAGE);

    expect(notifications.createMany).toHaveBeenCalled();
    expect(result.delivered).toBe(2);
  });
});
