import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { DayOfWeek, MenuItemStatus, SpiceLevel } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

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

const HHMM = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

// ── Menus ──

export class CreateMenuDto {
  @ApiProperty({ example: 'Main Menu', maxLength: 120 })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  @Transform(trim)
  name!: string;

  @ApiPropertyOptional({ example: 'Served all day', maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Transform(trim)
  description?: string;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateMenuDto extends PartialType(CreateMenuDto) {}

// ── Menu categories ──

export class CreateMenuCategoryDto {
  @ApiProperty({ example: 'Kababs', maxLength: 120 })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  @Transform(trim)
  name!: string;

  @ApiPropertyOptional({ example: 'کباب' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Transform(trim)
  nameUr?: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Transform(trim)
  description?: string;

  @ApiPropertyOptional({ example: 'https://cdn.zassdelivery.pk/categories/kababs.jpg' })
  @IsOptional()
  @IsUrl({ require_protocol: true })
  @MaxLength(500)
  imageUrl?: string;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateMenuCategoryDto extends PartialType(CreateMenuCategoryDto) {}

export class ReorderDto {
  @ApiProperty({
    type: [String],
    description: 'Ids in the desired order. Must list every member.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsString({ each: true })
  ids!: string[];
}

// ── Menu items ──

export class CreateMenuItemDto {
  @ApiProperty({ description: 'Menu category this dish belongs to.' })
  @IsString()
  menuCategoryId!: string;

  @ApiProperty({ example: 'Chapli Kabab', maxLength: 140 })
  @IsString()
  @MinLength(2)
  @MaxLength(140)
  @Transform(trim)
  name!: string;

  @ApiPropertyOptional({ example: 'چپلی کباب' })
  @IsOptional()
  @IsString()
  @MaxLength(140)
  @Transform(trim)
  nameUr?: string;

  @ApiPropertyOptional({ maxLength: 800 })
  @IsOptional()
  @IsString()
  @MaxLength(800)
  @Transform(trim)
  description?: string;

  @ApiPropertyOptional({ example: 'https://cdn.zassdelivery.pk/items/chapli.jpg' })
  @IsOptional()
  @IsUrl({ require_protocol: true })
  @MaxLength(500)
  imageUrl?: string;

  @ApiProperty({ description: 'Price in PKR.', example: 250, minimum: 0 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1000000)
  basePrice!: number;

  @ApiPropertyOptional({
    description: 'Promotional price. Must not exceed basePrice.',
    example: 199,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  discountedPrice?: number;

  @ApiPropertyOptional({ enum: MenuItemStatus, default: MenuItemStatus.AVAILABLE })
  @IsOptional()
  @IsEnum(MenuItemStatus)
  status?: MenuItemStatus;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  isVegetarian?: boolean;

  @ApiPropertyOptional({ enum: SpiceLevel, default: SpiceLevel.NONE })
  @IsOptional()
  @IsEnum(SpiceLevel)
  spiceLevel?: SpiceLevel;

  @ApiPropertyOptional({ example: 450 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10000)
  calories?: number;

  @ApiPropertyOptional({ example: 15 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(240)
  preparationMinutes?: number;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  isFeatured?: boolean;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number;

  // ── Availability ──

  @ApiPropertyOptional({
    enum: DayOfWeek,
    isArray: true,
    description: 'Days this dish is sold. Omit or send an empty array for every day.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(7)
  @ArrayUnique()
  @IsEnum(DayOfWeek, { each: true })
  availableDays?: DayOfWeek[];

  @ApiPropertyOptional({
    description:
      'Start of the serving window as local HH:mm. Must be sent together with ' +
      'availableTo; a half-specified window is ambiguous.',
    example: '07:00',
  })
  @IsOptional()
  @ValidateIf((dto: CreateMenuItemDto) => dto.availableTo !== undefined)
  @IsString()
  @Matches(HHMM, { message: 'availableFrom must be a 24-hour time such as "07:00"' })
  availableFrom?: string;

  @ApiPropertyOptional({ example: '11:00' })
  @IsOptional()
  @ValidateIf((dto: CreateMenuItemDto) => dto.availableFrom !== undefined)
  @IsString()
  @Matches(HHMM, { message: 'availableTo must be a 24-hour time such as "11:00"' })
  availableTo?: string;

  // ── Inventory ──

  @ApiPropertyOptional({
    description: 'Opt in to stock counting. Most kitchens cook to order and leave this off.',
    default: false,
  })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  trackInventory?: boolean;

  @ApiPropertyOptional({ example: 50, minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  stockQuantity?: number;

  @ApiPropertyOptional({ example: 5, minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  lowStockThreshold?: number;
}

export class UpdateMenuItemDto extends PartialType(CreateMenuItemDto) {}

// ── Variants ──

export class CreateVariantDto {
  @ApiProperty({ example: 'Full', maxLength: 80 })
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  @Transform(trim)
  name!: string;

  @ApiProperty({
    description: 'Absolute price, not a delta — an order line prices itself without the parent.',
    example: 2000,
  })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  price!: number;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  isDefault?: boolean;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  isAvailable?: boolean;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  trackInventory?: boolean;

  @ApiPropertyOptional({ example: 20, minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  stockQuantity?: number;
}

export class UpdateVariantDto extends PartialType(CreateVariantDto) {}

// ── Add-on groups and add-ons ──

export class CreateAddOnGroupDto {
  @ApiProperty({ example: 'Choose a drink', maxLength: 120 })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  @Transform(trim)
  name!: string;

  @ApiPropertyOptional({ description: 'Minimum selections.', example: 0, default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(20)
  minSelect?: number;

  @ApiPropertyOptional({ description: 'Maximum selections.', example: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  maxSelect?: number;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  isRequired?: boolean;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

export class UpdateAddOnGroupDto extends PartialType(CreateAddOnGroupDto) {}

export class CreateAddOnDto {
  @ApiProperty({ example: 'Extra Cheese', maxLength: 120 })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  @Transform(trim)
  name!: string;

  @ApiPropertyOptional({ example: 150, default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  price?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  isAvailable?: boolean;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

export class UpdateAddOnDto extends PartialType(CreateAddOnDto) {}

// ── Images ──

export class AddMenuItemImageDto {
  @ApiProperty({ example: 'https://cdn.zassdelivery.pk/items/chapli-2.jpg' })
  @IsUrl({ require_protocol: true }, { message: 'url must be a valid absolute URL' })
  @MaxLength(500)
  url!: string;

  @ApiPropertyOptional({ example: 'Served with naan', maxLength: 180 })
  @IsOptional()
  @IsString()
  @MaxLength(180)
  @Transform(trim)
  caption?: string;
}

// ── Inventory and bulk operations ──

export class AdjustStockDto {
  @ApiProperty({
    description:
      'Signed change. Negative sells stock, positive restocks. Applied ' +
      'atomically so two concurrent sales cannot oversell.',
    example: -3,
  })
  @Type(() => Number)
  @IsInt()
  @Min(-100000)
  @Max(100000)
  delta!: number;
}

export class BulkItemUpdateEntryDto {
  @ApiProperty()
  @IsString()
  id!: string;

  @ApiPropertyOptional({ enum: MenuItemStatus })
  @IsOptional()
  @IsEnum(MenuItemStatus)
  status?: MenuItemStatus;

  @ApiPropertyOptional({ example: 275 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  basePrice?: number;

  @ApiPropertyOptional({ example: 249, nullable: true })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  discountedPrice?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  isFeatured?: boolean;

  @ApiPropertyOptional({ example: 40, minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  stockQuantity?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  trackInventory?: boolean;
}

export class BulkUpdateItemsDto {
  @ApiProperty({
    type: [BulkItemUpdateEntryDto],
    description:
      'Applied in a single transaction: a bulk reprice either lands in full or ' +
      'not at all, so the menu is never left half-updated.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200, { message: 'at most 200 items may be updated in one request' })
  @ValidateNested({ each: true })
  @Type(() => BulkItemUpdateEntryDto)
  items!: BulkItemUpdateEntryDto[];
}

export class BulkStatusDto {
  @ApiProperty({ type: [String], description: 'Item ids to update.' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ArrayUnique()
  @IsString({ each: true })
  itemIds!: string[];

  @ApiProperty({ enum: MenuItemStatus })
  @IsEnum(MenuItemStatus)
  status!: MenuItemStatus;
}
