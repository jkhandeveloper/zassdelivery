import { ApiPropertyOptional } from '@nestjs/swagger';
import { MenuItemStatus, SpiceLevel } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsIn, IsNumber, IsOptional, IsString, Min } from 'class-validator';

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

export const MENU_ITEM_SORT_FIELDS = [
  'sortOrder',
  'name',
  'basePrice',
  'rating',
  'createdAt',
  'stockQuantity',
] as const;
export type MenuItemSortField = (typeof MENU_ITEM_SORT_FIELDS)[number];

export class ListMenuItemsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Free-text search over the dish name, backed by a trigram index.',
    example: 'kabab',
  })
  declare search?: string;

  @ApiPropertyOptional({ enum: MENU_ITEM_SORT_FIELDS, default: 'sortOrder' })
  @IsOptional()
  @IsIn(MENU_ITEM_SORT_FIELDS, {
    message: `sortBy must be one of: ${MENU_ITEM_SORT_FIELDS.join(', ')}`,
  })
  declare sortBy?: MenuItemSortField;

  @ApiPropertyOptional({ description: 'Restrict to one menu category.' })
  @IsOptional()
  @IsString()
  menuCategoryId?: string;

  @ApiPropertyOptional({ enum: MenuItemStatus })
  @IsOptional()
  @IsEnum(MenuItemStatus)
  status?: MenuItemStatus;

  @ApiPropertyOptional({ enum: SpiceLevel })
  @IsOptional()
  @IsEnum(SpiceLevel)
  spiceLevel?: SpiceLevel;

  @ApiPropertyOptional({ description: 'Vegetarian dishes only.' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  isVegetarian?: boolean;

  @ApiPropertyOptional({ description: 'Featured dishes only.' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  featuredOnly?: boolean;

  @ApiPropertyOptional({ example: 100, description: 'Minimum price in PKR.' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  minPrice?: number;

  @ApiPropertyOptional({ example: 1000, description: 'Maximum price in PKR.' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  maxPrice?: number;
}

/** Owner view: adds the low-stock filter and soft-deleted rows. */
export class ListMenuItemsAdminQueryDto extends ListMenuItemsQueryDto {
  @ApiPropertyOptional({
    description: 'Only tracked items at or below their low-stock threshold.',
    default: false,
  })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  lowStockOnly?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  includeDeleted?: boolean;
}

export const MENU_SORT_FIELDS = ['sortOrder', 'name', 'createdAt'] as const;

export class ListMenusQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: MENU_SORT_FIELDS, default: 'sortOrder' })
  @IsOptional()
  @IsIn(MENU_SORT_FIELDS)
  declare sortBy?: (typeof MENU_SORT_FIELDS)[number];

  @ApiPropertyOptional({ description: 'Only active menus.', default: false })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  activeOnly?: boolean;
}
