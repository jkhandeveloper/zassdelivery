import { NotificationChannel, NotificationType } from '@prisma/client';

import {
  DEFAULT_PREFERENCES,
  PreferenceResolver,
  type StoredPreference,
} from './preference-resolver';

const ALL_CHANNELS = [
  NotificationChannel.IN_APP,
  NotificationChannel.PUSH,
  NotificationChannel.SMS,
  NotificationChannel.EMAIL,
];

const QUIET = { startHour: 22, endHour: 8 };

/** 02:00 and 14:00 in Asia/Karachi, which is UTC+5. */
const MIDDLE_OF_THE_NIGHT = new Date('2026-08-10T21:00:00.000Z');
const MIDDLE_OF_THE_DAY = new Date('2026-08-10T09:00:00.000Z');

function stored(
  type: NotificationType,
  overrides: Partial<StoredPreference> = {},
): StoredPreference {
  return { type, inApp: true, push: true, sms: false, email: false, ...overrides };
}

describe('PreferenceResolver.effective', () => {
  const resolver = new PreferenceResolver();

  it('falls back to the defaults for a user who has changed nothing', () => {
    expect(resolver.effective(NotificationType.ORDER_UPDATE, [])).toEqual(
      DEFAULT_PREFERENCES[NotificationType.ORDER_UPDATE],
    );
  });

  it('uses a stored choice when there is one', () => {
    const preference = resolver.effective(NotificationType.PROMOTION, [
      stored(NotificationType.PROMOTION, { push: false }),
    ]);

    expect(preference.push).toBe(false);
    expect(preference.inApp).toBe(true);
  });

  it('does not let one category’s choice leak into another', () => {
    const preference = resolver.effective(NotificationType.ORDER_UPDATE, [
      stored(NotificationType.PROMOTION, { push: false, inApp: false }),
    ]);

    expect(preference.push).toBe(true);
  });

  it('leaves SMS off by default everywhere — it costs money per message', () => {
    for (const type of Object.values(NotificationType)) {
      expect(DEFAULT_PREFERENCES[type].sms).toBe(false);
    }
  });
});

describe('PreferenceResolver.resolve', () => {
  const resolver = new PreferenceResolver();

  it('returns only the channels that were both requested and allowed', () => {
    const channels = resolver.resolve({
      type: NotificationType.ORDER_UPDATE,
      stored: [],
      requested: [NotificationChannel.IN_APP, NotificationChannel.PUSH],
    });

    expect(channels).toEqual([NotificationChannel.IN_APP, NotificationChannel.PUSH]);
  });

  it('never widens beyond what the caller asked for', () => {
    const channels = resolver.resolve({
      type: NotificationType.ORDER_UPDATE,
      stored: [],
      requested: [NotificationChannel.IN_APP],
    });

    expect(channels).toEqual([NotificationChannel.IN_APP]);
  });

  it('drops a channel the user muted', () => {
    const channels = resolver.resolve({
      type: NotificationType.PROMOTION,
      stored: [stored(NotificationType.PROMOTION, { push: false })],
      requested: [NotificationChannel.IN_APP, NotificationChannel.PUSH],
    });

    expect(channels).toEqual([NotificationChannel.IN_APP]);
  });

  it('returns nothing when the user muted the category entirely', () => {
    const channels = resolver.resolve({
      type: NotificationType.PROMOTION,
      stored: [
        stored(NotificationType.PROMOTION, { inApp: false, push: false, sms: false, email: false }),
      ],
      requested: ALL_CHANNELS,
    });

    expect(channels).toEqual([]);
  });

  it('leaves SMS out unless the user turned it on', () => {
    expect(
      resolver.resolve({
        type: NotificationType.ORDER_UPDATE,
        stored: [],
        requested: ALL_CHANNELS,
      }),
    ).not.toContain(NotificationChannel.SMS);

    expect(
      resolver.resolve({
        type: NotificationType.ORDER_UPDATE,
        stored: [stored(NotificationType.ORDER_UPDATE, { sms: true })],
        requested: ALL_CHANNELS,
      }),
    ).toContain(NotificationChannel.SMS);
  });
});

describe('PreferenceResolver — quiet hours', () => {
  const resolver = new PreferenceResolver();

  it('holds back a promotional push in the middle of the night', () => {
    const channels = resolver.resolve({
      type: NotificationType.PROMOTION,
      stored: [],
      requested: [NotificationChannel.IN_APP, NotificationChannel.PUSH],
      quietHours: QUIET,
      now: MIDDLE_OF_THE_NIGHT,
    });

    // The in-app copy is still written, so the message is waiting in the
    // morning rather than lost.
    expect(channels).toEqual([NotificationChannel.IN_APP]);
  });

  it('delivers the same promotion during the day', () => {
    const channels = resolver.resolve({
      type: NotificationType.PROMOTION,
      stored: [],
      requested: [NotificationChannel.IN_APP, NotificationChannel.PUSH],
      quietHours: QUIET,
      now: MIDDLE_OF_THE_DAY,
    });

    expect(channels).toContain(NotificationChannel.PUSH);
  });

  it('never silences an order update — 3am is when that matters most', () => {
    const channels = resolver.resolve({
      type: NotificationType.ORDER_UPDATE,
      stored: [],
      requested: [NotificationChannel.PUSH],
      quietHours: QUIET,
      now: MIDDLE_OF_THE_NIGHT,
    });

    expect(channels).toEqual([NotificationChannel.PUSH]);
  });

  it('never silences wallet or support messages either', () => {
    for (const type of [NotificationType.WALLET, NotificationType.SUPPORT]) {
      expect(resolver.inQuietHours(type, QUIET, MIDDLE_OF_THE_NIGHT)).toBe(false);
    }
  });

  it('handles a window that wraps past midnight', () => {
    expect(resolver.inQuietHours(NotificationType.PROMOTION, QUIET, MIDDLE_OF_THE_NIGHT)).toBe(
      true,
    );
    expect(resolver.inQuietHours(NotificationType.PROMOTION, QUIET, MIDDLE_OF_THE_DAY)).toBe(false);
  });

  it('handles a window inside one day', () => {
    const daytimeWindow = { startHour: 9, endHour: 17 };

    expect(
      resolver.inQuietHours(NotificationType.PROMOTION, daytimeWindow, MIDDLE_OF_THE_DAY),
    ).toBe(true);
    expect(
      resolver.inQuietHours(NotificationType.PROMOTION, daytimeWindow, MIDDLE_OF_THE_NIGHT),
    ).toBe(false);
  });

  it('treats an empty window as no quiet hours at all', () => {
    expect(
      resolver.inQuietHours(
        NotificationType.PROMOTION,
        { startHour: 22, endHour: 22 },
        MIDDLE_OF_THE_NIGHT,
      ),
    ).toBe(false);
  });

  it('applies nothing when no window is configured', () => {
    expect(resolver.inQuietHours(NotificationType.PROMOTION, null, MIDDLE_OF_THE_NIGHT)).toBe(
      false,
    );
  });
});
