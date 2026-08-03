/** Correlation id header, read on the way in and echoed on the way out. */
export const REQUEST_ID_HEADER = 'x-request-id';

/** Pagination guard rails, enforced by `PaginationQueryDto`. */
export const PAGINATION_DEFAULT_PAGE = 1;
export const PAGINATION_DEFAULT_LIMIT = 20;
export const PAGINATION_MAX_LIMIT = 100;

/** Sort direction accepted by every list endpoint. */
export enum SortOrder {
  Asc = 'asc',
  Desc = 'desc',
}

/**
 * Pakistani mobile numbers in E.164: +92 followed by 3 and nine more digits.
 * Matches 03xx numbers only after normalisation to +92.
 */
export const PK_PHONE_E164_REGEX = /^\+923\d{9}$/;

/** Metres per degree of latitude — used by the Haversine helpers. */
export const EARTH_RADIUS_METRES = 6_371_000;
