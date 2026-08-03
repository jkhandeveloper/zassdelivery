import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

import {
  PAGINATION_DEFAULT_LIMIT,
  PAGINATION_DEFAULT_PAGE,
  PAGINATION_MAX_LIMIT,
  SortOrder,
} from '../constants/app.constants';

/**
 * Shared query parameters for every list endpoint. Feature modules extend this
 * class to add their own strongly-typed filters rather than accepting a
 * free-form filter language, which keeps validation and Swagger accurate.
 */
export class PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Page number, starting at 1.',
    minimum: 1,
    default: PAGINATION_DEFAULT_PAGE,
    example: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'page must be an integer' })
  @Min(1, { message: 'page must be at least 1' })
  page: number = PAGINATION_DEFAULT_PAGE;

  @ApiPropertyOptional({
    description: `Items per page (max ${PAGINATION_MAX_LIMIT}).`,
    minimum: 1,
    maximum: PAGINATION_MAX_LIMIT,
    default: PAGINATION_DEFAULT_LIMIT,
    example: 20,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limit must be an integer' })
  @Min(1, { message: 'limit must be at least 1' })
  @Max(PAGINATION_MAX_LIMIT, { message: `limit cannot exceed ${PAGINATION_MAX_LIMIT}` })
  limit: number = PAGINATION_DEFAULT_LIMIT;

  @ApiPropertyOptional({
    description:
      'Field to sort by. Each endpoint documents its own sortable fields and ' +
      'rejects anything outside that set.',
    example: 'createdAt',
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  sortBy?: string;

  @ApiPropertyOptional({
    description: 'Sort direction.',
    enum: SortOrder,
    default: SortOrder.Desc,
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.toLowerCase() : value,
  )
  @IsEnum(SortOrder, { message: 'sortOrder must be either "asc" or "desc"' })
  sortOrder: SortOrder = SortOrder.Desc;

  @ApiPropertyOptional({
    description: 'Free-text search term. Matching fields differ per endpoint.',
    example: 'karahi',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  search?: string;

  /** Offset derived from `page`/`limit`, for `prisma.findMany({ skip })`. */
  get skip(): number {
    return (this.page - 1) * this.limit;
  }
}
