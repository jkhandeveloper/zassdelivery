import { Injectable } from '@nestjs/common';

import { DeliveryPricingRepository } from '@/modules/carts/domain/repositories/cart.repository';
import {
  DELIVERY_FEE_SETTINGS,
  RIDER_RATE_SETTINGS,
  RIDER_SEARCH_SETTINGS,
  type DeliveryFeeRules,
} from '@/modules/carts/domain/services/delivery-fee.policy';

/**
 * Platform settings this module reads, with the defaults that apply when a key
 * has not been configured.
 *
 * Every one of these is commercial policy rather than product behaviour — how
 * long a rider has to answer an offer, how far away they may be. Keeping them
 * in the settings table means tuning them is an operator's decision, not a
 * release. The rider keeps the order's own delivery fee and tip; the per-km
 * rates that fee is priced from are exposed here so a rider can see them.
 */
export const RIDER_SETTINGS = {
  offerTimeoutSeconds: { key: 'dispatch.offer_timeout_seconds', fallback: 60 },
  ...RIDER_SEARCH_SETTINGS,
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

  /**
   * What a run pays, per kilometre and in total.
   *
   * Read through the same settings and fallbacks the cart prices with, so the
   * rate a rider is shown is the rate customers are actually charged.
   */
  async deliveryRates(): Promise<DeliveryFeeRules> {
    const [perKmFee, minFee, maxFee, maxDistanceKm] = await Promise.all([
      this.read(DELIVERY_FEE_SETTINGS.perKmFee),
      this.read(DELIVERY_FEE_SETTINGS.minFee),
      this.read(DELIVERY_FEE_SETTINGS.maxFee),
      this.read(DELIVERY_FEE_SETTINGS.maxDistanceKm),
    ]);

    return { perKmFee, minFee, maxFee, maxDistanceKm };
  }

  /** The lowest and highest per-kilometre rate a rider may set. */
  async riderRateBounds(): Promise<{ min: number; max: number }> {
    const [min, max] = await Promise.all([
      this.read(RIDER_RATE_SETTINGS.min),
      this.read(RIDER_RATE_SETTINGS.max),
    ]);

    return { min, max };
  }

  private read(setting: { key: string; fallback: number }): Promise<number> {
    return this.settings.numericSetting(setting.key, setting.fallback);
  }
}
