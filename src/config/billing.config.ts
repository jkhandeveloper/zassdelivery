import { registerAs } from '@nestjs/config';

export const BILLING_CONFIG_KEY = 'billing';

/**
 * How long a vendor trades before they are asked to pay, and how often that is
 * checked.
 *
 * Configuration rather than a setting because these are not prices an operator
 * tunes — they exist so a test environment can run a vendor through the whole
 * trial → reminder → suspension cycle in a day or two instead of a month. The
 * fee itself stays in the settings table, where an administrator can change it.
 */
export const billingConfig = registerAs(BILLING_CONFIG_KEY, () => ({
  /** Length of the free trial that starts when a listing is approved. */
  trialDays: Number(process.env.BILLING_TRIAL_DAYS ?? 30),

  /** Days an unpaid invoice keeps the listing open past its due date. */
  graceDays: Number(process.env.BILLING_GRACE_DAYS ?? 3),

  /**
   * When the billing sweep runs. Nightly in production; hourly is what makes a
   * one-day trial expire close to on time.
   */
  sweepCron: process.env.BILLING_SWEEP_CRON ?? '0 2 * * *',
}));
