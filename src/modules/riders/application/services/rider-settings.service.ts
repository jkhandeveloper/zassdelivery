import { Injectable } from '@nestjs/common';

import { DeliveryPricingRepository } from '@/modules/carts/domain/repositories/cart.repository';

import type { EarningRates } from '../../domain/services/earnings.calculator';

/**
 * Platform settings this module reads, with the defaults that apply when a key
 * has not been configured.
 *
 * Every one of these is commercial policy rather than product behaviour — what
 * a delivery pays, how long a rider has to answer an offer, how little they may
 * withdraw. Keeping them in the settings table means tuning them is an
 * operator's decision, not a release.
 */
export const RIDER_SETTINGS = {
  offerTimeoutSeconds: { key: 'dispatch.offer_timeout_seconds', fallback: 60 },
  searchRadiusKm: { key: 'dispatch.search_radius_km', fallback: 8 },
  locationFreshnessMinutes: { key: 'dispatch.location_freshness_minutes', fallback: 10 },
  baseFare: { key: 'earnings.base_fare', fallback: 60 },
  perKm: { key: 'earnings.per_km_rate', fallback: 18 },
  tipSharePercentage: { key: 'earnings.tip_share_percentage', fallback: 100 },
  minimumFare: { key: 'earnings.minimum_fare', fallback: 80 },
  minWithdrawalAmount: { key: 'payouts.min_withdrawal_amount', fallback: 500 },
} as const;

export interface DispatchSettings {
  offerTimeoutSeconds: number;
  searchRadiusKm: number;
  locationFreshnessMinutes: number;
}

@Injectable()
export class RiderSettingsService {
  constructor(private readonly settings: DeliveryPricingRepository) {}

  async dispatch(): Promise<DispatchSettings> {
    const [offerTimeoutSeconds, searchRadiusKm, locationFreshnessMinutes] = await Promise.all([
      this.read(RIDER_SETTINGS.offerTimeoutSeconds),
      this.read(RIDER_SETTINGS.searchRadiusKm),
      this.read(RIDER_SETTINGS.locationFreshnessMinutes),
    ]);

    return { offerTimeoutSeconds, searchRadiusKm, locationFreshnessMinutes };
  }

  async earningRates(): Promise<EarningRates> {
    const [baseFare, perKm, tipSharePercentage, minimumFare] = await Promise.all([
      this.read(RIDER_SETTINGS.baseFare),
      this.read(RIDER_SETTINGS.perKm),
      this.read(RIDER_SETTINGS.tipSharePercentage),
      this.read(RIDER_SETTINGS.minimumFare),
    ]);

    return { baseFare, perKm, tipSharePercentage, minimumFare };
  }

  minimumWithdrawal(): Promise<number> {
    return this.read(RIDER_SETTINGS.minWithdrawalAmount);
  }

  private read(setting: { key: string; fallback: number }): Promise<number> {
    return this.settings.numericSetting(setting.key, setting.fallback);
  }
}
