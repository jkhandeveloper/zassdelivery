import { Injectable } from '@nestjs/common';
import { SettingValueType } from '@prisma/client';
import type { Prisma } from '@prisma/client';

import {
  toPaymentQrCodes,
  toStoredPaymentQrCodes,
  type PaymentQrCodeDto,
  type SetPaymentQrCodesDto,
} from '@/common/dto/payment-qr-code.dto';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import { SettingRepository } from '@/modules/admin/domain/repositories/admin.repository';

import { BILLING_QR_SETTING_KEY, BillingPricingService } from '../services/billing-pricing.service';

/**
 * Where vendors send their monthly fee.
 *
 * The platform's own JazzCash, Easypaisa and bank QR codes — the mirror image of
 * a restaurant's scan-to-pay list, and deliberately the same shape, so the same
 * editor renders both and a code that works for a customer works here.
 *
 * Stored as a setting rather than a table because it is exactly one list that
 * changes when an account is rotated, and a table of one row is a table nobody
 * remembers exists.
 */
@Injectable()
export class GetPlatformQrCodesUseCase {
  constructor(private readonly pricing: BillingPricingService) {}

  execute(): Promise<PaymentQrCodeDto[]> {
    return this.pricing.payToQrCodes();
  }
}

@Injectable()
export class SetPlatformQrCodesUseCase {
  constructor(private readonly settings: SettingRepository) {}

  /**
   * Replaces the list wholesale.
   *
   * A replacement rather than a patch, for the same reason a restaurant's list
   * is: a removed code must actually be gone, not left behind by a save that
   * only knew about the rows still on screen. An empty list is allowed and
   * means "nobody can pay" — the vendor's screen says so in as many words
   * rather than showing a due date and nowhere to send the money.
   */
  async execute(dto: SetPaymentQrCodesDto, actor: AuthenticatedUser): Promise<PaymentQrCodeDto[]> {
    const stored = toStoredPaymentQrCodes(dto.codes);

    await this.settings.upsert({
      key: BILLING_QR_SETTING_KEY,
      value: JSON.stringify(stored),
      valueType: SettingValueType.JSON,
      group: 'billing',
      description:
        "The platform's own JazzCash, Easypaisa and bank QR codes, which vendors " +
        'transfer their monthly fee to.',
      // Never public. These are the platform's own accounts, and the only people
      // who need them are vendors with an invoice open, who are already
      // authenticated when they ask.
      isPublic: false,
      updatedById: actor.id,
    });

    // Read back through the same defensive parser the vendor screen uses, so
    // what the administrator sees after saving is exactly what a vendor will.
    return toPaymentQrCodes(stored as Prisma.JsonValue);
  }
}
