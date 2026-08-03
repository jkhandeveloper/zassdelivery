import { BadRequestException } from '@nestjs/common';

import type { SortOrder } from '../constants/app.constants';
import type { PaginatedResult, PaginationMeta } from '../interfaces/paginated-result.interface';

/** Derives the pagination block from a total count and the requested window. */
export function buildPaginationMeta(total: number, page: number, limit: number): PaginationMeta {
  const totalPages = limit > 0 ? Math.ceil(total / limit) : 0;

  return {
    total,
    page,
    limit,
    totalPages,
    hasPreviousPage: page > 1,
    hasNextPage: page < totalPages,
  };
}

/** Convenience wrapper pairing a page of rows with its metadata. */
export function paginate<T>(
  items: T[],
  total: number,
  page: number,
  limit: number,
): PaginatedResult<T> {
  return { items, meta: buildPaginationMeta(total, page, limit) };
}

/**
 * Translates `sortBy`/`sortOrder` into a Prisma `orderBy` clause.
 *
 * `sortBy` arrives from the query string, so it is checked against an
 * explicit allow-list. Passing it through unchecked would let a caller order
 * by any column — including ones the endpoint does not expose — and would make
 * the query planner's behaviour attacker-influenced.
 */
export function buildOrderBy<TField extends string>(
  sortBy: string | undefined,
  sortOrder: SortOrder,
  allowedFields: readonly TField[],
  fallbackField: TField,
): Record<string, SortOrder> {
  if (sortBy === undefined || sortBy.length === 0) {
    return { [fallbackField]: sortOrder };
  }

  if (!allowedFields.includes(sortBy as TField)) {
    throw new BadRequestException(
      `Cannot sort by "${sortBy}". Allowed fields: ${allowedFields.join(', ')}.`,
    );
  }

  return { [sortBy]: sortOrder };
}
