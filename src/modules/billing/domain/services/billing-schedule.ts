/**
 * When a vendor owes money, when they are warned, and when the listing goes
 * down.
 *
 * Pure and free of Prisma on purpose: this is the part of billing that decides
 * whether somebody's business stops trading, and it should be testable by
 * handing it two dates rather than by standing up a database. Everything here
 * is a function of `now` and the invoice's own dates — nothing reads a clock
 * it was not given, so the whole schedule can be replayed at any instant.
 */

/**
 * A cycle is a fixed 30 days rather than a calendar month.
 *
 * The consequence is deliberate and worth stating: the due date walks backwards
 * through the calendar — 15 January, 14 February, 16 March — and a vendor sees
 * 12.17 bills a year rather than 12. That is the trade for every cycle being
 * the same length, so no vendor pays the same fee for 28 days that another pays
 * for 31.
 */
export const BILLING_CYCLE_DAYS = 30;

/**
 * How long an unpaid invoice keeps trading past its due date.
 *
 * A working restaurant taken down the moment a transfer is late is a restaurant
 * that loses a dinner service over a bank holiday. Three days covers a weekend
 * and a failed transfer without letting a genuine non-payer trade for a week.
 */
export const BILLING_GRACE_DAYS = 3;

/**
 * Lead times, in days before the due date, at which a vendor is warned.
 *
 * Held in descending order because that is the order they fire in; the bucket
 * search below sorts for itself and does not rely on it.
 */
export const REMINDER_LEAD_DAYS = [7, 3, 1] as const;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** One period of cover, and the two deadlines that hang off it. */
export interface BillingPeriod {
  periodStart: Date;
  periodEnd: Date;
  /**
   * Equal to `periodStart`: the fee buys the month ahead, not the month behind.
   * That is what makes a free first month the thing that gets a vendor trading
   * before they are asked for anything.
   */
  dueAt: Date;
  /** When an invoice still unpaid takes the listing down. */
  blockAt: Date;
}

export function addDays(from: Date, days: number): Date {
  return new Date(from.getTime() + days * MS_PER_DAY);
}

/**
 * Whole days from `now` until `target`, rounded away from zero.
 *
 * Rounded up rather than truncated so that "six and a half days left" counts as
 * seven and trips the seven-day warning on the first sweep inside the window,
 * instead of falling through it and warning a day late.
 */
export function daysUntil(target: Date, now: Date): number {
  return Math.ceil((target.getTime() - now.getTime()) / MS_PER_DAY);
}

/** The period that follows one starting at `periodStart`. */
export function periodFrom(periodStart: Date): BillingPeriod {
  const periodEnd = addDays(periodStart, BILLING_CYCLE_DAYS);

  return {
    periodStart,
    periodEnd,
    dueAt: periodStart,
    blockAt: addDays(periodStart, BILLING_GRACE_DAYS),
  };
}

/**
 * The free first month, starting the day a listing is approved.
 *
 * Billing begins at approval rather than at registration because an unapproved
 * listing cannot take an order, and charging for a month a vendor was not
 * allowed to trade in is how a platform loses the vendor before it earns
 * anything from them.
 */
export function trialPeriod(approvedAt: Date): BillingPeriod {
  return periodFrom(approvedAt);
}

/**
 * Which reminder window `now` falls in, or null if it is too early to warn or
 * the date has already passed.
 *
 * Returns the *bucket* — one of `REMINDER_LEAD_DAYS` — which exists only to
 * decide whether to send and to stop the daily sweep sending the same warning
 * twice. The message itself should quote `daysUntil(dueAt, now)` and the real
 * date, never the bucket: if a sweep is missed and seven days becomes two, the
 * vendor must be told two.
 */
export function reminderBucket(dueAt: Date, now: Date): number | null {
  const remaining = daysUntil(dueAt, now);

  if (remaining < 0) {
    return null;
  }

  // Ascending, so the tightest window that still contains `remaining` wins: two
  // days left is a three-day warning, not a seven-day one.
  const ascending = [...REMINDER_LEAD_DAYS].sort((a, b) => a - b);

  return ascending.find((lead) => remaining <= lead) ?? null;
}

/**
 * Whether this sweep should send a reminder, given what has already gone out.
 *
 * `lastReminderDay` is the tightest bucket already sent for this invoice. A
 * reminder fires only when the vendor has crossed into a tighter window, which
 * is what makes a sweep that runs every day — or twice in one day after a
 * restart — send three warnings over a cycle rather than thirty.
 */
export function shouldRemind(
  dueAt: Date,
  now: Date,
  lastReminderDay: number | null,
): number | null {
  const bucket = reminderBucket(dueAt, now);

  if (bucket === null) {
    return null;
  }

  if (lastReminderDay !== null && bucket >= lastReminderDay) {
    return null;
  }

  return bucket;
}

/** Past the due date with the invoice still unpaid, but inside grace. */
export function isPastDue(dueAt: Date, now: Date): boolean {
  return now.getTime() >= dueAt.getTime();
}

/** Grace exhausted: the listing comes down. */
export function isBlockable(blockAt: Date, now: Date): boolean {
  return now.getTime() >= blockAt.getTime();
}
