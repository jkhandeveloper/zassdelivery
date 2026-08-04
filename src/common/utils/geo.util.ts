import { EARTH_RADIUS_METRES } from '../constants/app.constants';

/**
 * Great-circle distance in metres.
 *
 * Straight-line rather than road distance: the platform has no routing engine,
 * and for dispatch decisions inside a single town the difference is small
 * enough that ranking riders by it picks the same rider a road distance would.
 */
export function haversineMetres(
  fromLat: number,
  fromLng: number,
  toLat: number,
  toLng: number,
): number {
  const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;
  const deltaLat = toRadians(toLat - fromLat);
  const deltaLng = toRadians(toLng - fromLng);

  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(toRadians(fromLat)) * Math.cos(toRadians(toLat)) * Math.sin(deltaLng / 2) ** 2;

  return EARTH_RADIUS_METRES * 2 * Math.asin(Math.sqrt(a));
}

/** The same distance in kilometres, rounded to two decimals. */
export function haversineKm(
  fromLat: number,
  fromLng: number,
  toLat: number,
  toLng: number,
): number {
  return Math.round(haversineMetres(fromLat, fromLng, toLat, toLng) / 10) / 100;
}
