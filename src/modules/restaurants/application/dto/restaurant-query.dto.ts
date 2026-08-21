import { ApiPropertyOptional } from '@nestjs/swagger';
import { BusinessType, PriceRange, RestaurantStatus } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';

import { PaginationQueryDto } from '@/common/dto/pagination-query.dto';

const toBoolean = ({ value }: { value: unknown }): unknown => {
  if (typeof value === 'boolean') {
    return value;
  }
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  return value;
};

/**
 * Sortable columns. `distance` is handled separately because it is computed
 * per-request rather than stored, and it requires coordinates.
 */
export const RESTAURANT_SORT_FIELDS = [
  'createdAt',
  'name',
  'rating',
  'minOrderAmount',
  'avgPreparationMinutes',
] as const;
export type RestaurantSortField = (typeof RESTAURANT_SORT_FIELDS)[number];

export class SearchRestaurantsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Free-text search over the restaurant name, backed by a trigram index.',
    example: 'kabab',
  })
  declare search?: string;

  @ApiPropertyOptional({ enum: RESTAURANT_SORT_FIELDS, default: 'rating' })
  @IsOptional()
  @IsIn(RESTAURANT_SORT_FIELDS, {
    message: `sortBy must be one of: ${RESTAURANT_SORT_FIELDS.join(', ')}`,
  })
  declare sortBy?: RestaurantSortField;

  @ApiPropertyOptional({ description: 'Filter by city id.' })
  @IsOptional()
  @IsString()
  cityId?: string;

  @ApiPropertyOptional({ description: 'Filter by delivery zone id.' })
  @IsOptional()
  @IsString()
  zoneId?: string;

  @ApiPropertyOptional({ description: 'Filter by cuisine category slug.', example: 'bbq' })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional({
    enum: BusinessType,
    description:
      'Filter by the kind of business — bakeries, cafes, cafeterias. Independent ' +
      'of `category`, which is the cuisine.',
    example: BusinessType.BAKERY,
  })
  @IsOptional()
  @IsEnum(BusinessType)
  businessType?: BusinessType;

  @ApiPropertyOptional({ enum: PriceRange })
  @IsOptional()
  @IsEnum(PriceRange)
  priceRange?: PriceRange;

  @ApiPropertyOptional({
    description: 'Minimum average rating.',
    example: 4,
    minimum: 0,
    maximum: 5,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(5)
  minRating?: number;

  @ApiPropertyOptional({
    description: 'Only restaurants currently accepting orders.',
    default: false,
  })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  acceptingOnly?: boolean;

  @ApiPropertyOptional({
    description:
      'Customer latitude. When supplied with longitude, results are limited to ' +
      'restaurants whose delivery radius reaches this point.',
    example: 34.0091,
  })
  @IsOptional()
  @ValidateIf((dto: SearchRestaurantsQueryDto) => dto.longitude !== undefined)
  @Type(() => Number)
  @IsLatitude({ message: 'latitude and longitude must be supplied together' })
  latitude?: number;

  @ApiPropertyOptional({ example: 71.7869 })
  @IsOptional()
  @ValidateIf((dto: SearchRestaurantsQueryDto) => dto.latitude !== undefined)
  @Type(() => Number)
  @IsLongitude({ message: 'latitude and longitude must be supplied together' })
  longitude?: number;
}

/** Administrative listing: adds status filtering and soft-deleted rows. */
export class ListRestaurantsAdminQueryDto extends SearchRestaurantsQueryDto {
  @ApiPropertyOptional({ enum: RestaurantStatus })
  @IsOptional()
  @IsEnum(RestaurantStatus)
  status?: RestaurantStatus;

  @ApiPropertyOptional({ description: 'Filter by owner id.' })
  @IsOptional()
  @IsString()
  ownerId?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  includeDeleted?: boolean;
}

export const CATEGORY_SORT_FIELDS = ['sortOrder', 'name', 'createdAt'] as const;

export class ListCategoriesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: CATEGORY_SORT_FIELDS, default: 'sortOrder' })
  @IsOptional()
  @IsIn(CATEGORY_SORT_FIELDS)
  declare sortBy?: (typeof CATEGORY_SORT_FIELDS)[number];

  @ApiPropertyOptional({ description: 'Only categories that are enabled.', default: false })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  activeOnly?: boolean;
}
