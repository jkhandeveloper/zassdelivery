import type {
  BusinessType,
  DayOfWeek,
  PriceRange,
  Prisma,
  Restaurant,
  RestaurantHour,
  RestaurantImage,
  RestaurantStatus,
} from '@prisma/client';

import type { PaginatedResult } from '@/common/interfaces/paginated-result.interface';

/** A restaurant with the relations the listing and detail views render. */
export type RestaurantWithRelations = Restaurant & {
  categories: Array<{ category: { id: string; name: string; slug: string } }>;
  city: { id: string; name: string; slug: string };
  zone: { id: string; name: string; slug: string };
  images?: RestaurantImage[];
  hours?: RestaurantHour[];
};

export interface ListRestaurantsFilter {
  page: number;
  limit: number;
  orderBy: Prisma.RestaurantOrderByWithRelationInput;
  search?: string;
  cityId?: string;
  zoneId?: string;
  categorySlug?: string;
  businessType?: BusinessType;
  priceRange?: PriceRange;
  status?: RestaurantStatus;
  minRating?: number;
  ownerId?: string;
  /** Only restaurants currently taking orders. */
  acceptingOnly?: boolean;
  /**
   * Restrict to restaurants whose delivery radius covers this point.
   * Filtered in SQL so pagination counts stay correct.
   */
  near?: { latitude: number; longitude: number };
  includeDeleted?: boolean;
}

export interface CreateRestaurantInput {
  ownerId: string;
  name: string;
  nameUr?: string | null;
  slug: string;
  description?: string | null;
  phone: string;
  email?: string | null;
  cityId: string;
  zoneId: string;
  addressLine: string;
  landmark?: string | null;
  latitude: number;
  longitude: number;
  businessType?: BusinessType;
  priceRange?: PriceRange;
  minOrderAmount?: number;
  avgPreparationMinutes?: number;
  deliveryRadiusMeters?: number;
  categoryIds: string[];
}

export type UpdateRestaurantInput = Partial<Omit<CreateRestaurantInput, 'ownerId' | 'slug'>>;

export interface HourInput {
  dayOfWeek: DayOfWeek;
  opensAt: string;
  closesAt: string;
  isClosed: boolean;
}

/**
 * Restaurant is the aggregate root; images and opening hours have no meaning
 * outside it, so they are reached through this repository rather than getting
 * repositories of their own.
 */
export abstract class RestaurantRepository {
  abstract findMany(
    filter: ListRestaurantsFilter,
  ): Promise<PaginatedResult<RestaurantWithRelations>>;
  abstract findById(id: string, includeDeleted?: boolean): Promise<RestaurantWithRelations | null>;
  abstract findBySlug(slug: string): Promise<RestaurantWithRelations | null>;
  abstract slugExists(slug: string): Promise<boolean>;
  abstract countForOwner(ownerId: string): Promise<number>;

  abstract create(input: CreateRestaurantInput): Promise<RestaurantWithRelations>;
  abstract update(id: string, input: UpdateRestaurantInput): Promise<RestaurantWithRelations>;
  abstract softDelete(id: string): Promise<void>;

  abstract setStatus(
    id: string,
    status: RestaurantStatus,
    context: { approvedById?: string; rejectionReason?: string },
  ): Promise<RestaurantWithRelations>;
  abstract setAcceptingOrders(id: string, accepting: boolean): Promise<RestaurantWithRelations>;

  // ── Opening hours ──
  abstract findHours(restaurantId: string): Promise<RestaurantHour[]>;
  /** Replaces the whole week in one transaction. */
  abstract replaceHours(restaurantId: string, hours: HourInput[]): Promise<RestaurantHour[]>;

  // ── Images ──
  abstract findImages(restaurantId: string): Promise<RestaurantImage[]>;
  abstract addImage(
    restaurantId: string,
    input: { url: string; caption?: string | null; sortOrder: number },
  ): Promise<RestaurantImage>;
  abstract countImages(restaurantId: string): Promise<number>;
  abstract findImageById(imageId: string): Promise<RestaurantImage | null>;
  abstract deleteImage(imageId: string): Promise<void>;
  abstract reorderImages(restaurantId: string, orderedIds: string[]): Promise<RestaurantImage[]>;
}
