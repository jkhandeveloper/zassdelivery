/** Cursorless pagination envelope returned by every list use-case. */
export interface PaginationMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasPreviousPage: boolean;
  hasNextPage: boolean;
}

export interface PaginatedResult<T> {
  items: T[];
  meta: PaginationMeta;
}

/** Narrowing guard used by the response interceptor to hoist pagination meta. */
export function isPaginatedResult(value: unknown): value is PaginatedResult<unknown> {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Partial<PaginatedResult<unknown>>;
  return Array.isArray(candidate.items) && typeof candidate.meta?.total === 'number';
}
