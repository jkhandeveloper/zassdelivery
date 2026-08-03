import { BadRequestException } from '@nestjs/common';

import { SortOrder } from '../constants/app.constants';
import { buildOrderBy, buildPaginationMeta, paginate } from './pagination.util';

describe('buildPaginationMeta', () => {
  it('computes page counts and navigation flags for a middle page', () => {
    const meta = buildPaginationMeta(137, 3, 20);

    expect(meta).toEqual({
      total: 137,
      page: 3,
      limit: 20,
      totalPages: 7,
      hasPreviousPage: true,
      hasNextPage: true,
    });
  });

  it('marks the first page as having no previous page', () => {
    expect(buildPaginationMeta(50, 1, 20).hasPreviousPage).toBe(false);
  });

  it('marks the last page as having no next page', () => {
    const meta = buildPaginationMeta(40, 2, 20);

    expect(meta.totalPages).toBe(2);
    expect(meta.hasNextPage).toBe(false);
  });

  it('handles an empty result set without reporting a next page', () => {
    const meta = buildPaginationMeta(0, 1, 20);

    expect(meta.totalPages).toBe(0);
    expect(meta.hasNextPage).toBe(false);
    expect(meta.hasPreviousPage).toBe(false);
  });

  it('rounds a partial final page up', () => {
    expect(buildPaginationMeta(21, 1, 20).totalPages).toBe(2);
  });
});

describe('paginate', () => {
  it('pairs the rows with their metadata', () => {
    const result = paginate(['a', 'b'], 2, 1, 20);

    expect(result.items).toEqual(['a', 'b']);
    expect(result.meta.total).toBe(2);
  });
});

describe('buildOrderBy', () => {
  const allowed = ['createdAt', 'fullName', 'status'] as const;

  it('falls back to the default field when sortBy is omitted', () => {
    expect(buildOrderBy(undefined, SortOrder.Desc, allowed, 'createdAt')).toEqual({
      createdAt: 'desc',
    });
  });

  it('uses an allowed field when supplied', () => {
    expect(buildOrderBy('fullName', SortOrder.Asc, allowed, 'createdAt')).toEqual({
      fullName: 'asc',
    });
  });

  it('rejects a field outside the allow-list', () => {
    // Without this guard a caller could order by any column on the model,
    // including ones the endpoint never exposes.
    expect(() => buildOrderBy('passwordHash', SortOrder.Asc, allowed, 'createdAt')).toThrow(
      BadRequestException,
    );
  });

  it('names the permitted fields in the rejection message', () => {
    expect(() => buildOrderBy('nope', SortOrder.Asc, allowed, 'createdAt')).toThrow(
      /createdAt, fullName, status/,
    );
  });

  it('treats an empty sortBy as absent', () => {
    expect(buildOrderBy('', SortOrder.Asc, allowed, 'createdAt')).toEqual({ createdAt: 'asc' });
  });
});
