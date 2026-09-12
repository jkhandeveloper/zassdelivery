import { Injectable } from '@nestjs/common';
import { NotificationType, SettingValueType } from '@prisma/client';

import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import { SettingRepository } from '@/modules/admin/domain/repositories/admin.repository';
import { NotifyService } from '@/modules/notifications/application/use-cases/notify.service';

import { BillingRepository } from '../../domain/repositories/billing.repository';
import { DefaultFeeDto } from '../dto/billing-response.dto';
import type { SetDefaultFeeDto } from '../dto/billing.dto';
import {
  BILLING_FEE_SETTING_KEY,
  BillingPricingService,
} from '../services/billing-pricing.service';

@Injectable()
export class GetDefaultFeeUseCase {
  constructor(private readonly pricing: BillingPricingService) {}

  async execute(): Promise<DefaultFeeDto> {
    return { monthlyFee: await this.pricing.defaultMonthlyFee(), currency: 'PKR' };
  }
}

@Injectable()
export class SetDefaultFeeUseCase {
  constructor(
    private readonly settings: SettingRepository,
    private readonly billing: BillingRepository,
    private readonly notify: NotifyService,
  ) {}

  /**
   * Changes what the platform charges.
   *
   * The new rate reaches every standard-rate vendor's *current* unpaid invoice,
   * not just their next one. A price change that took a month to appear would
   * leave every vendor looking at a figure we no longer charge, and the first
   * they would know of it is a payment that came up short.
   *
   * Vendors on a negotiated rate are untouched — that is what negotiating one
   * means.
   */
  async execute(dto: SetDefaultFeeDto, actor: AuthenticatedUser): Promise<DefaultFeeDto> {
    await this.settings.upsert({
      key: BILLING_FEE_SETTING_KEY,
      value: String(dto.monthlyFee),
      valueType: SettingValueType.NUMBER,
      group: 'billing',
      description:
        'Standard monthly platform fee a vendor pays, in PKR. A vendor on a ' +
        'negotiated rate carries their own amount on the subscription instead.',
      isPublic: false,
      updatedById: actor.id,
    });

    const ownerIds = await this.billing.repriceStandardRateInvoices(dto.monthlyFee);

    if (ownerIds.length > 0) {
      // One message, many recipients: the figure is the same for all of them,
      // and this is the path that reads preferences once for the whole batch.
      await this.notify.notifyMany(ownerIds, {
        type: NotificationType.SYSTEM,
        title: 'Your monthly platform fee has changed',
        body:
          `The platform fee is now PKR ${dto.monthlyFee} a month. Your current ` +
          'invoice has been updated to match — open Subscription to see what is due.',
        data: { kind: 'billing' },
      });
    }

    return { monthlyFee: dto.monthlyFee, currency: 'PKR' };
  }
}
