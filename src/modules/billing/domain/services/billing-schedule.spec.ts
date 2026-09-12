import {
  BILLING_CYCLE_DAYS,
  BILLING_GRACE_DAYS,
  addDays,
  daysUntil,
  isBlockable,
  isPastDue,
  periodFrom,
  reminderBucket,
  shouldRemind,
  trialPeriod,
} from './billing-schedule';

/** A fixed instant, so nothing here depends on when the suite runs. */
const START = new Date('2026-01-15T09:00:00.000Z');

describe('periodFrom', () => {
  it('runs for exactly the cycle length', () => {
    const period = periodFrom(START);

    expect(period.periodStart).toEqual(START);
    expect(period.periodEnd).toEqual(addDays(START, BILLING_CYCLE_DAYS));
  });

  it('charges up front, so the fee falls due as the period opens', () => {
    expect(periodFrom(START).dueAt).toEqual(START);
  });

  it('takes the listing down only after the grace window', () => {
    expect(periodFrom(START).blockAt).toEqual(addDays(START, BILLING_GRACE_DAYS));
  });

  /**
   * The documented consequence of a fixed 30-day cycle. If this ever reads
   * "15 February" somebody has quietly switched the platform to calendar
   * months, and every vendor's due date has moved.
   */
  it('walks backwards through the calendar rather than holding a date', () => {
    const first = periodFrom(new Date('2026-01-15T00:00:00.000Z'));
    const second = periodFrom(first.periodEnd);

    expect(first.periodEnd.getUTCMonth()).toBe(1);
    expect(first.periodEnd.getUTCDate()).toBe(14);
    expect(second.periodEnd.getUTCDate()).toBe(16);
    expect(second.periodEnd.getUTCMonth()).toBe(2);
  });
});

describe('trialPeriod', () => {
  it('starts the free month the day the listing is approved', () => {
    const trial = trialPeriod(START);

    expect(trial.periodStart).toEqual(START);
    expect(trial.periodEnd).toEqual(addDays(START, BILLING_CYCLE_DAYS));
  });
});

describe('daysUntil', () => {
  it('counts whole days ahead', () => {
    expect(daysUntil(addDays(START, 7), START)).toBe(7);
  });

  /**
   * Rounded up, so the first sweep inside a window trips that window's warning
   * instead of falling through it and warning a day late.
   */
  it('rounds a part-day up', () => {
    const almostSeven = new Date(addDays(START, 7).getTime() - 12 * 60 * 60 * 1000);

    expect(daysUntil(almostSeven, START)).toBe(7);
  });

  it('goes negative once the date has passed', () => {
    expect(daysUntil(START, addDays(START, 2))).toBe(-2);
  });
});

describe('reminderBucket', () => {
  it('stays quiet while the due date is far off', () => {
    expect(reminderBucket(addDays(START, 20), START)).toBeNull();
  });

  it('opens the first window exactly seven days out', () => {
    expect(reminderBucket(addDays(START, 7), START)).toBe(7);
  });

  it('keeps a part-day inside the window it is in', () => {
    const sixAndAHalf = new Date(addDays(START, 7).getTime() - 12 * 60 * 60 * 1000);

    expect(reminderBucket(sixAndAHalf, START)).toBe(7);
  });

  it('tightens to the three-day window', () => {
    expect(reminderBucket(addDays(START, 3), START)).toBe(3);
  });

  /**
   * Two days left is a three-day warning, not a seven-day one: the bucket is
   * the tightest window that still contains the time remaining.
   */
  it('picks the tightest window containing the time left', () => {
    expect(reminderBucket(addDays(START, 2), START)).toBe(3);
  });

  it('falls to the last window on the final day', () => {
    expect(reminderBucket(addDays(START, 1), START)).toBe(1);
    expect(reminderBucket(START, START)).toBe(1);
  });

  it('stops once the date has passed, because that is a different message', () => {
    expect(reminderBucket(START, addDays(START, 1))).toBeNull();
  });
});

describe('shouldRemind', () => {
  it('sends the first warning when nothing has gone out', () => {
    expect(shouldRemind(addDays(START, 7), START, null)).toBe(7);
  });

  /**
   * The reason the sweep can run daily. Without this every vendor would get
   * thirty identical warnings a cycle.
   */
  it('stays silent for the rest of a window it has already warned in', () => {
    const dueAt = addDays(START, 7);

    expect(shouldRemind(dueAt, START, 7)).toBeNull();
    expect(shouldRemind(dueAt, addDays(START, 1), 7)).toBeNull();
    expect(shouldRemind(dueAt, addDays(START, 2), 7)).toBeNull();
  });

  it('speaks up again on crossing into a tighter window', () => {
    const dueAt = addDays(START, 7);

    expect(shouldRemind(dueAt, addDays(START, 4), 7)).toBe(3);
    expect(shouldRemind(dueAt, addDays(START, 6), 3)).toBe(1);
  });

  /**
   * A sweep that does not run for a few days — a deploy, an outage — must still
   * warn the vendor rather than skipping straight to taking them down.
   */
  it('still warns after a missed sweep', () => {
    expect(shouldRemind(addDays(START, 2), START, null)).toBe(3);
  });

  it('never repeats a window after the whole ladder has been sent', () => {
    expect(shouldRemind(addDays(START, 1), START, 1)).toBeNull();
  });
});

describe('isPastDue', () => {
  it('is false right up to the due date', () => {
    const dueAt = addDays(START, 1);

    expect(isPastDue(dueAt, START)).toBe(false);
  });

  it('turns true the instant the date arrives', () => {
    expect(isPastDue(START, START)).toBe(true);
    expect(isPastDue(START, addDays(START, 1))).toBe(true);
  });
});

describe('isBlockable', () => {
  /**
   * The whole point of grace: past due is not the same as blocked, and a vendor
   * inside the window is still trading.
   */
  it('is false while the vendor is inside grace', () => {
    const { dueAt, blockAt } = periodFrom(START);

    expect(isPastDue(dueAt, addDays(START, 1))).toBe(true);
    expect(isBlockable(blockAt, addDays(START, 1))).toBe(false);
  });

  it('turns true once grace runs out', () => {
    const { blockAt } = periodFrom(START);

    expect(isBlockable(blockAt, blockAt)).toBe(true);
    expect(isBlockable(blockAt, addDays(START, BILLING_GRACE_DAYS + 1))).toBe(true);
  });
});
