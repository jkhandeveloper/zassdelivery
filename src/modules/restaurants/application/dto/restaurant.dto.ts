import { ApiProperty, ApiPropertyOptional, PartialType, OmitType } from '@nestjs/swagger';
import { DayOfWeek, PriceRange, RestaurantStatus } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

import { PK_PHONE_E164_REGEX } from '@/common/constants/app.constants';
import { normalisePhone } from '@/modules/auth/application/dto/auth.dto';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

const HHMM = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

export class RegisterRestaurantDto {
  @ApiProperty({ example: 'Chapli Kabab House', minLength: 2, maxLength: 140 })
  @IsString()
  @MinLength(2)
  @MaxLength(140)
  @Transform(trim)
  name!: string;

  @ApiPropertyOptional({ example: 'چپلی کباب ہاؤس', maxLength: 140 })
  @IsOptional()
  @IsString()
  @MaxLength(140)
  @Transform(trim)
  nameUr?: string;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  @Transform(trim)
  description?: string;

  @ApiProperty({ example: '+923005551234', description: 'Contact number in E.164 or 03XX form.' })
  @Transform(({ value }: { value: unknown }) => normalisePhone(value))
  @IsString()
  @Matches(PK_PHONE_E164_REGEX, { message: 'phone must be a valid Pakistani mobile number' })
  phone!: string;

  @ApiPropertyOptional({ example: 'owner@chaplikabab.pk' })
  @IsOptional()
  @IsEmail()
  @MaxLength(160)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  email?: string;

  @ApiProperty({ example: 'Main GT Road, near Pabbi Bus Stand', maxLength: 240 })
  @IsString()
  @MinLength(5)
  @MaxLength(240)
  @Transform(trim)
  addressLine!: string;

  @ApiPropertyOptional({ example: 'Opposite the petrol pump', maxLength: 180 })
  @IsOptional()
  @IsString()
  @MaxLength(180)
  @Transform(trim)
  landmark?: string;

  @ApiProperty({
    description: 'Latitude. The city and delivery zone are resolved from the coordinates.',
    example: 34.0088,
  })
  @Type(() => Number)
  @IsLatitude()
  latitude!: number;

  @ApiProperty({ example: 71.7881 })
  @Type(() => Number)
  @IsLongitude()
  longitude!: number;

  @ApiProperty({
    description: 'Cuisine category ids. At least one is required for the listing to be findable.',
    type: [String],
    example: ['clx8f2k9a0000zo79b1h2c3d4'],
  })
  @IsArray()
  @ArrayMinSize(1, { message: 'at least one category is required' })
  @ArrayMaxSize(5, { message: 'a restaurant may belong to at most 5 categories' })
  @ArrayUnique()
  @IsString({ each: true })
  categoryIds!: string[];

  @ApiPropertyOptional({ enum: PriceRange, default: PriceRange.MODERATE })
  @IsOptional()
  @IsEnum(PriceRange)
  priceRange?: PriceRange;

  @ApiPropertyOptional({ description: 'Minimum basket value in PKR.', example: 250, minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100000)
  minOrderAmount?: number;

  @ApiPropertyOptional({ description: 'Typical preparation time in minutes.', example: 25 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(240)
  avgPreparationMinutes?: number;

  @ApiPropertyOptional({
    description: 'How far this restaurant will deliver from its own door, in metres.',
    example: 5000,
    minimum: 100,
    maximum: 50000,
    default: 5000,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(100)
  @Max(50000)
  deliveryRadiusMeters?: number;
}

/**
 * Owner-side edit. `OmitType` drops the coordinates from the optional set and
 * they are re-declared below, because moving a restaurant re-resolves its zone
 * and both values must then be supplied together.
 */
export class UpdateRestaurantDto extends PartialType(
  OmitType(RegisterRestaurantDto, ['latitude', 'longitude'] as const),
) {
  @ApiPropertyOptional({
    description: 'New latitude. Must be sent together with longitude.',
    example: 34.0088,
  })
  @IsOptional()
  @Type(() => Number)
  @IsLatitude()
  latitude?: number;

  @ApiPropertyOptional({ example: 71.7881 })
  @IsOptional()
  @Type(() => Number)
  @IsLongitude()
  longitude?: number;
}

export class RejectRestaurantDto {
  @ApiProperty({
    description: 'Shown to the owner, so a rejection is actionable rather than a dead end.',
    example: 'The food licence photo is unreadable. Please re-upload it.',
    maxLength: 500,
  })
  @IsString()
  @MinLength(10, { message: 'reason must explain what the owner needs to fix' })
  @MaxLength(500)
  @Transform(trim)
  reason!: string;
}

export class ChangeRestaurantStatusDto {
  @ApiProperty({ enum: RestaurantStatus })
  @IsEnum(RestaurantStatus)
  status!: RestaurantStatus;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class SetAcceptingOrdersDto {
  @ApiProperty({
    description: 'Owner-controlled switch, independent of opening hours.',
    example: false,
  })
  @Transform(({ value }: { value: unknown }) => value === true || value === 'true')
  @IsBoolean()
  isAcceptingOrders!: boolean;
}

// ── Business hours ──

export class BusinessHourDto {
  @ApiProperty({ enum: DayOfWeek })
  @IsEnum(DayOfWeek)
  dayOfWeek!: DayOfWeek;

  @ApiProperty({
    description: 'Local opening time as HH:mm (Asia/Karachi).',
    example: '11:00',
  })
  @IsString()
  @Matches(HHMM, { message: 'opensAt must be a 24-hour time such as "11:00"' })
  opensAt!: string;

  @ApiProperty({
    description:
      'Local closing time as HH:mm. A value at or before opensAt means the ' +
      'window runs past midnight, e.g. 18:00 to 02:00.',
    example: '23:00',
  })
  @IsString()
  @Matches(HHMM, { message: 'closesAt must be a 24-hour time such as "23:00"' })
  closesAt!: string;

  @ApiPropertyOptional({ description: 'Closed all day.', default: false })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => value === true || value === 'true')
  @IsBoolean()
  isClosed?: boolean;
}

export class SetBusinessHoursDto {
  @ApiProperty({
    type: [BusinessHourDto],
    description:
      'The full week. Days omitted here are treated as closed, so the request ' +
      'is a complete replacement rather than a patch — that avoids a half-set ' +
      'schedule silently keeping stale hours from a previous save.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(7)
  @ValidateNested({ each: true })
  @Type(() => BusinessHourDto)
  hours!: BusinessHourDto[];
}

// ── Images ──

export class AddRestaurantImageDto {
  @ApiProperty({ example: 'https://cdn.zassdelivery.pk/chapli-kabab-house/interior.jpg' })
  @IsUrl({ require_protocol: true }, { message: 'url must be a valid absolute URL' })
  @MaxLength(500)
  url!: string;

  @ApiPropertyOptional({ example: 'Dining area', maxLength: 180 })
  @IsOptional()
  @IsString()
  @MaxLength(180)
  @Transform(trim)
  caption?: string;
}

export class ReorderImagesDto {
  @ApiProperty({
    type: [String],
    description: 'Image ids in the order they should appear. Must list every image.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsString({ each: true })
  imageIds!: string[];
}

// ── Categories ──

export class CreateRestaurantCategoryDto {
  @ApiProperty({ example: 'BBQ', maxLength: 80 })
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  @Transform(trim)
  name!: string;

  @ApiPropertyOptional({ example: 'باربی کیو' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  @Transform(trim)
  nameUr?: string;

  @ApiPropertyOptional({
    description: 'URL-safe identifier. Derived from the name when omitted.',
    example: 'bbq',
  })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  @Matches(/^[a-z0-9-]+$/, {
    message: 'slug may contain only lowercase letters, numbers and hyphens',
  })
  slug?: string;

  @ApiPropertyOptional({ example: 'https://cdn.zassdelivery.pk/categories/bbq.svg' })
  @IsOptional()
  @IsUrl({ require_protocol: true })
  @MaxLength(500)
  iconUrl?: string;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => value === true || value === 'true')
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateRestaurantCategoryDto extends PartialType(CreateRestaurantCategoryDto) {}
