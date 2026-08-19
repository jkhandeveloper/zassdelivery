/** A serviceable delivery zone, with the city it belongs to. */
export interface ServiceableZone {
  id: string;
  name: string;
  slug: string;
  centerLat: number;
  centerLng: number;
  radiusMeters: number;
  deliveryFee: number;
  minOrderAmount: number;
  etaMinutes: number;
  city: {
    id: string;
    name: string;
    nameUr: string | null;
    slug: string;
    province: string;
  };
}

export abstract class ZoneRepository {
  /**
   * Every active zone in an active city, ordered by city then zone name.
   *
   * There are a few dozen of these at most, and they change about as often as
   * the company opens a new town — so the whole set is returned unpaginated and
   * cached hard at the edge rather than dribbled out a page at a time.
   */
  abstract findServiceable(): Promise<ServiceableZone[]>;
}
