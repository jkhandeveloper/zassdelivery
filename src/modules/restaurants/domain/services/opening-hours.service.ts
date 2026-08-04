import { DayOfWeek, type RestaurantHour } from '@prisma/client';

/** `DayOfWeek` indexed the way `Date.getDay()` reports it (0 = Sunday). */
const DAYS_FROM_SUNDAY: DayOfWeek[] = [
  DayOfWeek.SUNDAY,
  DayOfWeek.MONDAY,
  DayOfWeek.TUESDAY,
  DayOfWeek.WEDNESDAY,
  DayOfWeek.THURSDAY,
  DayOfWeek.FRIDAY,
  DayOfWeek.SATURDAY,
];

export interface OpenState {
  isOpen: boolean;
  /** Today's window, or null when closed all day. */
  opensAt: string | null;
  closesAt: string | null;
  /** Minutes until the restaurant next opens, when currently closed. */
  opensInMinutes: number | null;
}

/**
 * Decides whether a restaurant is open right now.
 *
 * Times are stored as local "HH:mm" strings, so the comparison is done in the
 * platform's timezone rather than the server's. A container running in UTC
 * would otherwise report a Peshawar restaurant closed for five hours a day.
 */
export class OpeningHoursService {
  constructor(private readonly timezone = 'Asia/Karachi') {}

  /** Local wall-clock time as minutes since midnight, plus the local weekday. */
  private localNow(now: Date): { minutes: number; day: DayOfWeek } {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: this.timezone,
      hour: '2-digit',
      minute: '2-digit',
      weekday: 'short',
      hour12: false,
    }).formatToParts(now);

    const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? '0');
    const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? '0');
    const weekday = parts.find((part) => part.type === 'weekday')?.value ?? 'Sun';

    const index = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(weekday);

    return {
      // 24:00 is reported as hour 24 by some ICU versions; normalise to 0.
      minutes: (hour % 24) * 60 + minute,
      day: DAYS_FROM_SUNDAY[index === -1 ? 0 : index] ?? DayOfWeek.SUNDAY,
    };
  }

  private static toMinutes(time: string): number {
    const [hours, minutes] = time.split(':');
    return Number(hours ?? 0) * 60 + Number(minutes ?? 0);
  }

  evaluate(hours: RestaurantHour[], now: Date = new Date()): OpenState {
    const { minutes, day } = this.localNow(now);
    const today = hours.find((entry) => entry.dayOfWeek === day);

    if (!today || today.isClosed) {
      return {
        isOpen: false,
        opensAt: null,
        closesAt: null,
        opensInMinutes: this.minutesUntilNextOpening(hours, day, minutes),
      };
    }

    const opens = OpeningHoursService.toMinutes(today.opensAt);
    const closes = OpeningHoursService.toMinutes(today.closesAt);

    // A closing time at or before the opening time means the window runs past
    // midnight — "18:00 to 02:00" is a normal shift for a late-night grill.
    const isOpen =
      closes > opens ? minutes >= opens && minutes < closes : minutes >= opens || minutes < closes;

    return {
      isOpen,
      opensAt: today.opensAt,
      closesAt: today.closesAt,
      opensInMinutes: isOpen ? null : this.minutesUntilNextOpening(hours, day, minutes),
    };
  }

  /** Scans forward up to a week to find the next opening. */
  private minutesUntilNextOpening(
    hours: RestaurantHour[],
    today: DayOfWeek,
    nowMinutes: number,
  ): number | null {
    const todayIndex = DAYS_FROM_SUNDAY.indexOf(today);

    for (let offset = 0; offset < 7; offset += 1) {
      const day = DAYS_FROM_SUNDAY[(todayIndex + offset) % 7];
      const entry = hours.find((row) => row.dayOfWeek === day);

      if (!entry || entry.isClosed) {
        continue;
      }

      const opens = OpeningHoursService.toMinutes(entry.opensAt);

      if (offset === 0 && opens <= nowMinutes) {
        continue;
      }

      return offset * 1440 + opens - nowMinutes;
    }

    // Every day is marked closed.
    return null;
  }
}
