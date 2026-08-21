import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  BusinessType,
  DayOfWeek,
  PriceRange,
  RestaurantStatus,
  type RestaurantHour,
  type RestaurantImage,
} from '@prisma/client';

import type { RestaurantWithRelations } from '../../domain/repositories/restaurant.repository';
import type { OpenState } from '../../domain/services/opening-hours.service';

export class CategorySummaryDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ example: 'BBQ' })
  name!: string;

  @ApiProperty({ example: 'bbq' })
  slug!: string;
}

export class RestaurantImageDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  url!: string;

  @ApiPropertyOptional({ nullable: true })
  caption!: string | null;

  @ApiProperty({ example: 0 })
  sortOrder!: number;
}

export class BusinessHourResponseDto {
  @ApiProperty({ enum: DayOfWeek })
  dayOfWeek!: DayOfWeek;

  @ApiProperty({ example: '11:00' })
  opensAt!: string;

  @ApiProperty({ example: '23:00' })
  closesAt!: string;

  @ApiProperty({ example: false })
  isClosed!: boolean;
}

export class RestaurantDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ example: 'Chapli Kabab House' })
  name!: string;

  @ApiPropertyOptional({ nullable: true })
  nameUr!: string | null;

  @ApiProperty({ example: 'chapli-kabab-house-pabbi' })
  slug!: string;

  @ApiPropertyOptional({ nullable: true })
  description!: string | null;

  @ApiPropertyOptional({ nullable: true })
  logoUrl!: string | null;

  @ApiPropertyOptional({ nullable: true })
  coverUrl!: string | null;

  @ApiProperty({ example: '+923005551234' })
  phone!: string;

  @ApiProperty({ example: 'Main GT Road, near Pabbi Bus Stand' })
  addressLine!: string;

  @ApiPropertyOptional({ nullable: true })
  landmark!: string | null;

  @ApiProperty({ example: 34.0088 })
  latitude!: number;

  @ApiProperty({ example: 71.7881 })
  longitude!: number;

  @ApiProperty({ type: CategorySummaryDto })
  city!: CategorySummaryDto;

  @ApiProperty({ type: CategorySummaryDto })
  zone!: CategorySummaryDto;

  @ApiProperty({ type: [CategorySummaryDto] })
  categories!: CategorySummaryDto[];

  @ApiProperty({ enum: RestaurantStatus })
  status!: RestaurantStatus;

  @ApiProperty({
    enum: BusinessType,
    description: 'The kind of establishment. The cuisines it cooks are in `categories`.',
  })
  businessType!: BusinessType;

  @ApiProperty({ enum: PriceRange })
  priceRange!: PriceRange;

  @ApiProperty({ example: true, description: "The owner's manual on/off switch." })
  isAcceptingOrders!: boolean;

  @ApiProperty({ example: false })
  isFeatured!: boolean;

  @ApiProperty({
    example: true,
    description: 'Computed from the opening hours in Asia/Karachi.',
  })
  isOpenNow!: boolean;

  @ApiProperty({
    example: true,
    description:
      'True only when approved, accepting orders and currently open — this is ' +
      'the single flag a client should use to enable the order button.',
  })
  canOrderNow!: boolean;

  @ApiPropertyOptional({ nullable: true, example: 45 })
  opensInMinutes!: number | null;

  @ApiProperty({ example: 4.5 })
  rating!: number;

  @ApiProperty({ example: 128 })
  ratingCount!: number;

  @ApiProperty({ example: 250 })
  minOrderAmount!: number;

  @ApiProperty({ example: 25 })
  avgPreparationMinutes!: number;

  @ApiProperty({ example: 5000 })
  deliveryRadiusMeters!: number;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Metres from the coordinates supplied in the query, when provided.',
    example: 820,
  })
  distanceMeters?: number | null;

  @ApiPropertyOptional({ type: [RestaurantImageDto] })
  images?: RestaurantImageDto[];

  @ApiPropertyOptional({ type: [BusinessHourResponseDto] })
  hours?: BusinessHourResponseDto[];

  @ApiProperty()
  createdAt!: Date;
}

/** Adds the fields only staff and the owner are allowed to see. */
export class RestaurantAdminDto extends RestaurantDto {
  @ApiProperty()
  ownerId!: string;

  @ApiProperty({ example: 15, description: 'Platform commission percentage.' })
  commissionRate!: number;

  @ApiPropertyOptional({ nullable: true })
  submittedAt!: Date | null;

  @ApiPropertyOptional({ nullable: true })
  approvedAt!: Date | null;

  @ApiPropertyOptional({ nullable: true })
  approvedById!: string | null;

  @ApiPropertyOptional({ nullable: true })
  rejectionReason!: string | null;

  @ApiPropertyOptional({ nullable: true })
  deletedAt!: Date | null;
}

export function toImageDto(image: RestaurantImage): RestaurantImageDto {
  return {
    id: image.id,
    url: image.url,
    caption: image.caption,
    sortOrder: image.sortOrder,
  };
}

export function toHourDto(hour: RestaurantHour): BusinessHourResponseDto {
  return {
    dayOfWeek: hour.dayOfWeek,
    opensAt: hour.opensAt,
    closesAt: hour.closesAt,
    isClosed: hour.isClosed,
  };
}

export interface RestaurantDtoOptions {
  openState?: OpenState;
  distanceMeters?: number | null;
  includePrivate?: boolean;
}

/**
 * Projects a restaurant onto the wire shape.
 *
 * An explicit allow-list: `commissionRate` and the approval trail sit on the
 * same row and must never reach a customer, so private fields are opt-in
 * rather than opt-out.
 */
export function toRestaurantDto(
  restaurant: RestaurantWithRelations,
  options: RestaurantDtoOptions = {},
): RestaurantDto | RestaurantAdminDto {
  const isOpenNow = options.openState?.isOpen ?? false;

  const dto: RestaurantDto = {
    id: restaurant.id,
    name: restaurant.name,
    nameUr: restaurant.nameUr,
    slug: restaurant.slug,
    description: restaurant.description,
    logoUrl: restaurant.logoUrl,
    coverUrl: restaurant.coverUrl,
    phone: restaurant.phone,
    addressLine: restaurant.addressLine,
    landmark: restaurant.landmark,
    latitude: restaurant.latitude,
    longitude: restaurant.longitude,
    city: restaurant.city,
    zone: restaurant.zone,
    categories: restaurant.categories.map((link) => link.category),
    status: restaurant.status,
    businessType: restaurant.businessType,
    priceRange: restaurant.priceRange,
    isAcceptingOrders: restaurant.isAcceptingOrders,
    isFeatured: restaurant.isFeatured,
    isOpenNow,
    canOrderNow:
      restaurant.status === RestaurantStatus.ACTIVE && restaurant.isAcceptingOrders && isOpenNow,
    opensInMinutes: options.openState?.opensInMinutes ?? null,
    rating: Number(restaurant.rating),
    ratingCount: restaurant.ratingCount,
    minOrderAmount: Number(restaurant.minOrderAmount),
    avgPreparationMinutes: restaurant.avgPreparationMinutes,
    deliveryRadiusMeters: restaurant.deliveryRadiusMeters,
    createdAt: restaurant.createdAt,
  };

  if (options.distanceMeters !== undefined) {
    dto.distanceMeters = options.distanceMeters;
  }

  if (restaurant.images) {
    dto.images = restaurant.images.map(toImageDto);
  }

  if (restaurant.hours) {
    dto.hours = restaurant.hours.map(toHourDto);
  }

  if (options.includePrivate !== true) {
    return dto;
  }

  return {
    ...dto,
    ownerId: restaurant.ownerId,
    commissionRate: Number(restaurant.commissionRate),
    submittedAt: restaurant.submittedAt,
    approvedAt: restaurant.approvedAt,
    approvedById: restaurant.approvedById,
    rejectionReason: restaurant.rejectionReason,
    deletedAt: restaurant.deletedAt,
  };
}
