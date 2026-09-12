import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { PaymentQrCodeDto, toPaymentQrCodes } from '@/common/dto/payment-qr-code.dto';
import { SettingRepository } from '@/modules/admin/domain/repositories/admin.repository';

/** The standard monthly fee, in PKR. */
export const BILLING_FEE_SETTING_KEY = 'billing.vendor_monthly_fee';

/** The platform's own QR codes, which vendors transfer their fee to. */
export const BILLING_QR_SETTING_KEY = 'billing.payment_qr_codes';

/**
 * Used only if the setting is missing or unreadable.
 *
 * A fallback rather than a throw: an invoice that cannot be priced would stop
 * the nightly sweep for every vendor on the platform, and a wrong-but-sane
 * number that an administrator can correct is a far smaller problem than
 * billing silently halting.
 */
export const FALLBACK_MONTHLY_FEE = 2000;

/**
 * What a vendor pays, and where they pay it.
 *
 * Both answers live in the settings table rather than in configuration, because
 * both change without a deployment: a price rise is an operator's decision, and
 * the platform's own wallet QR codes are rotated the same way a restaurant
 * rotates its own.
 */
@Injectable()
export class BillingPricingService {
  constructor(private readonly settings: SettingRepository) {}

  /** The platform-wide rate, for a vendor with no negotiated price. */
  async defaultMonthlyFee(): Promise<number> {
    const setting = await this.settings.findByKey(BILLING_FEE_SETTING_KEY);

    if (setting === null) {
      return FALLBACK_MONTHLY_FEE;
    }

    const parsed = Number(setting.value);

    // A blank or malformed setting reads as NaN, and `Number('')` is 0 — which
    // would quietly make the platform free for everybody.
    return Number.isFinite(parsed) && parsed > 0 ? parsed : FALLBACK_MONTHLY_FEE;
  }

  /**
   * What this particular vendor pays.
   *
   * Their own rate if they have been given one, otherwise the platform default
   * — which is what lets a price change reach every standard-rate vendor
   * without rewriting a row per subscription.
   */
  async effectiveFee(subscription: { monthlyFee: Prisma.Decimal | null }): Promise<number> {
    if (subscription.monthlyFee !== null) {
      return Number(subscription.monthlyFee);
    }

    return this.defaultMonthlyFee();
  }

  /**
   * The platform's scan-to-pay codes.
   *
   * An empty list is a real state and is reported as one: it means nobody has
   * configured where vendors should send money, and the billing screen says so
   * rather than showing a vendor an empty box and a due date.
   */
  async payToQrCodes(): Promise<PaymentQrCodeDto[]> {
    const setting = await this.settings.findByKey(BILLING_QR_SETTING_KEY);

    if (setting === null) {
      return [];
    }

    try {
      // Stored as JSON in a text column, so nothing but this vouches for its
      // shape; `toPaymentQrCodes` drops any entry that is not a usable code.
      return toPaymentQrCodes(JSON.parse(setting.value) as Prisma.JsonValue);
    } catch {
      return [];
    }
  }
}
