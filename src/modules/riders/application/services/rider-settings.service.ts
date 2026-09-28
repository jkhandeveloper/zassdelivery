import { Injectable } from '@nestjs/common';

import { DeliveryPricingRepository } from '@/modules/carts/domain/repositories/cart.repository';

/**
 * Platform settings this module reads, with the defaults that apply when a key
 * has not been configured.
 *
 * Every one of these is commercial policy rather than product behaviour — how
 * long a rider has to answer an offer, how far away they may be. Keeping them
 * in the settings table means tuning them is an operator's decision, not a
 * release. What a delivery pays is not here: the rider keeps the order's own
 * delivery fee and tip.
 */
export const RIDER_SETTINGS = {
  offerTimeoutSeconds: { key: 'dispatch.offer_timeout_seconds', fallback: 60 },
  searchRadiusKm: { key: 'dispatch.search_radius_km', fallback: 8 },
  locationFreshnessMinutes: { key: 'dispatch.location_freshness_minutes', fallback: 10 },
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

  private read(setting: { key: string; fallback: number }): Promise<number> {
    return this.settings.numericSetting(setting.key, setting.fallback);
  }
}
