/**
 * What a delivery costs, as a function of how far it goes.
 *
 * The rider keeps the whole delivery fee, so this is also what a run pays
 * them: charging by the kilometre is what makes a longer run worth more than a
 * short one, rather than every delivery in a zone paying the same.
 */
export interface DeliveryFeeRules {
  /** Charged per kilometre between the business and the door. */
  perKmFee: number;
  /** The least a delivery costs, however short the run. */
  minFee: number;
  /** The most a delivery costs, however the other figures are set. */
  maxFee: number;
  /** Runs longer than this are not delivered at all. */
  maxDistanceKm: number;
}

/**
 * The platform settings behind the rules, with the defaults that apply when a
 * key has not been configured: Rs. 50 a kilometre, up to 3 km and Rs. 150.
 */
export const DELIVERY_FEE_SETTINGS = {
  perKmFee: { key: 'delivery.per_km_fee', fallback: 50 },
  minFee: { key: 'delivery.min_fee', fallback: 50 },
  maxFee: { key: 'delivery.max_fee', fallback: 150 },
  maxDistanceKm: { key: 'delivery.max_distance_km', fallback: 3 },
} as const;

/**
 * The fee for a run of `distanceKm`, or null when it is too far to deliver.
 *
 * Whole rupees: the fee is handed over in cash at a door more often than not,
 * and nobody has change for paisa.
 */
export function distanceFee(distanceKm: number, rules: DeliveryFeeRules): number | null {
  if (distanceKm > rules.maxDistanceKm) {
    return null;
  }

  const metered = Math.round(Math.max(0, distanceKm) * rules.perKmFee);

  // The ceiling is applied last, so a minimum configured above the maximum
  // cannot push a fee past the cap.
  return Math.min(Math.max(metered, rules.minFee), rules.maxFee);
}
