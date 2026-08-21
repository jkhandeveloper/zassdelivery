import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BusinessType, PriceRange } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

import { PaginationQueryDto } from '@/common/dto/pagination-query.dto';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

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

export const RESTAURANT_SEARCH_SORTS = ['relevance', 'rating', 'distance', 'preparation'] as const;
export const FOOD_SEARCH_SORTS = ['relevance', 'price_asc', 'price_desc', 'rating'] as const;

/** Coordinates are only meaningful as a pair. */
class GeoQueryDto {
  @ApiPropertyOptional({
    description:
      'Customer latitude. Sent with longitude, results are limited to ' +
      'restaurants that can actually deliver here, and distanceMeters is returned.',
    example: 34.0091,
  })
  @ValidateIf((dto: GeoQueryDto) => dto.latitude !== undefined || dto.longitude !== undefined)
  @Type(() => Number)
  @IsLatitude({ message: 'latitude and longitude must be supplied together' })
  latitude?: number;

  @ApiPropertyOptional({ example: 71.7869 })
  @ValidateIf((dto: GeoQueryDto) => dto.latitude !== undefined || dto.longitude !== undefined)
  @Type(() => Number)
  @IsLongitude({ message: 'latitude and longitude must be supplied together' })
  longitude?: number;

  @ApiPropertyOptional({
    description: 'Search radius in metres. Capped by each restaurant’s own delivery radius.',
    example: 5000,
    default: 15000,
    minimum: 100,
    maximum: 50000,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(100)
  @Max(50000)
  radiusMeters?: number;
}

export class SearchRestaurantsDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description:
      'Search phrase. Supports quoted phrases and negation, e.g. `"chapli kabab" -pizza`.',
    example: 'kabab',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Transform(trim)
  q?: string;

  @ApiPropertyOptional({ enum: RESTAURANT_SEARCH_SORTS, default: 'relevance' })
  @IsOptional()
  @IsIn(RESTAURANT_SEARCH_SORTS, {
    message: `sort must be one of: ${RESTAURANT_SEARCH_SORTS.join(', ')}`,
  })
  sort?: (typeof RESTAURANT_SEARCH_SORTS)[number];

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
    description: 'Filter by the kind of business, independent of the cuisine.',
  })
  @IsOptional()
  @IsEnum(BusinessType)
  businessType?: BusinessType;

  @ApiPropertyOptional({ enum: PriceRange })
  @IsOptional()
  @IsEnum(PriceRange)
  priceRange?: PriceRange;

  @ApiPropertyOptional({ example: 4, minimum: 0, maximum: 5 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(5)
  minRating?: number;

  @ApiPropertyOptional({ description: 'Only restaurants currently accepting orders.' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  openNow?: boolean;

  @ApiPropertyOptional({ example: 34.0091 })
  @ValidateIf(
    (dto: SearchRestaurantsDto) => dto.latitude !== undefined || dto.longitude !== undefined,
  )
  @Type(() => Number)
  @IsLatitude({ message: 'latitude and longitude must be supplied together' })
  latitude?: number;

  @ApiPropertyOptional({ example: 71.7869 })
  @ValidateIf(
    (dto: SearchRestaurantsDto) => dto.latitude !== undefined || dto.longitude !== undefined,
  )
  @Type(() => Number)
  @IsLongitude({ message: 'latitude and longitude must be supplied together' })
  longitude?: number;

  @ApiPropertyOptional({ example: 5000, default: 15000 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(100)
  @Max(50000)
  radiusMeters?: number;
}

export class SearchFoodDto extends PaginationQueryDto {
  @ApiPropertyOptional({ example: 'karahi' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Transform(trim)
  q?: string;

  @ApiPropertyOptional({ enum: FOOD_SEARCH_SORTS, default: 'relevance' })
  @IsOptional()
  @IsIn(FOOD_SEARCH_SORTS, { message: `sort must be one of: ${FOOD_SEARCH_SORTS.join(', ')}` })
  sort?: (typeof FOOD_SEARCH_SORTS)[number];

  @ApiPropertyOptional({ description: 'Restrict to one restaurant.' })
  @IsOptional()
  @IsString()
  restaurantId?: string;

  @ApiPropertyOptional({ description: 'Filter by the restaurant’s cuisine category.' })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  isVegetarian?: boolean;

  @ApiPropertyOptional({ example: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  minPrice?: number;

  @ApiPropertyOptional({ example: 1000 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  maxPrice?: number;

  @ApiPropertyOptional({ example: 34.0091 })
  @ValidateIf((dto: SearchFoodDto) => dto.latitude !== undefined || dto.longitude !== undefined)
  @Type(() => Number)
  @IsLatitude({ message: 'latitude and longitude must be supplied together' })
  latitude?: number;

  @ApiPropertyOptional({ example: 71.7869 })
  @ValidateIf((dto: SearchFoodDto) => dto.latitude !== undefined || dto.longitude !== undefined)
  @Type(() => Number)
  @IsLongitude({ message: 'latitude and longitude must be supplied together' })
  longitude?: number;

  @ApiPropertyOptional({ example: 5000, default: 15000 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(100)
  @Max(50000)
  radiusMeters?: number;
}

export class NearbySearchDto extends GeoQueryDto {
  @ApiProperty({ description: 'Customer latitude.', example: 34.0091 })
  @Type(() => Number)
  @IsLatitude()
  declare latitude: number;

  @ApiProperty({ description: 'Customer longitude.', example: 71.7869 })
  @Type(() => Number)
  @IsLongitude()
  declare longitude: number;

  @ApiPropertyOptional({ example: 20, default: 20, minimum: 1, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}

export class SearchCategoriesDto {
  @ApiPropertyOptional({ example: 'bbq' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  @Transform(trim)
  q?: string;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}

export class AutocompleteDto {
  @ApiProperty({
    description: 'Partial term. At least two characters, so the index stays selective.',
    example: 'kar',
    minLength: 2,
  })
  @IsString()
  @MinLength(2, { message: 'q must be at least 2 characters' })
  @MaxLength(60)
  @Transform(trim)
  q!: string;

  @ApiPropertyOptional({ default: 10, minimum: 1, maximum: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  limit?: number;
}

export class TrendingDto {
  @ApiPropertyOptional({
    description: 'Rolling window in days over which orders are counted.',
    default: 7,
    minimum: 1,
    maximum: 90,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(90)
  days?: number;

  @ApiPropertyOptional({ default: 10, minimum: 1, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;

  @ApiPropertyOptional({ description: 'Restrict to one city.' })
  @IsOptional()
  @IsString()
  cityId?: string;
}

export class PopularDto {
  @ApiPropertyOptional({ default: 10, minimum: 1, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;

  @ApiPropertyOptional({ description: 'Restrict to one city.' })
  @IsOptional()
  @IsString()
  cityId?: string;
}
