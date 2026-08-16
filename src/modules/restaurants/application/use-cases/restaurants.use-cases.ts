import { Injectable } from '@nestjs/common';
import { RestaurantStatus, UserRole } from '@prisma/client';

import { EARTH_RADIUS_METRES } from '@/common/constants/app.constants';
import {
  BusinessRuleViolationException,
  ForbiddenOperationException,
  ResourceConflictException,
  ResourceNotFoundException,
} from '@/common/exceptions/domain.exception';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import type { PaginatedResult } from '@/common/interfaces/paginated-result.interface';
import { buildOrderBy } from '@/common/utils/pagination.util';
import { AddressRepository } from '@/modules/users/domain/repositories/address.repository';

import { RestaurantCategoryRepository } from '../../domain/repositories/restaurant-category.repository';
import {
  RestaurantRepository,
  type RestaurantWithRelations,
} from '../../domain/repositories/restaurant.repository';
import { OpeningHoursService } from '../../domain/services/opening-hours.service';
import type {
  ListRestaurantsAdminQueryDto,
  SearchRestaurantsQueryDto,
} from '../dto/restaurant-query.dto';
import { RESTAURANT_SORT_FIELDS } from '../dto/restaurant-query.dto';
import {
  toRestaurantDto,
  type RestaurantDto,
  type RestaurantAdminDto,
} from '../dto/restaurant-response.dto';
import type { RegisterRestaurantDto, UpdateRestaurantDto } from '../dto/restaurant.dto';

/** One owner cannot list an unbounded number of restaurants. */
const MAX_RESTAURANTS_PER_OWNER = 10;

/** Great-circle distance in metres between two points. */
export function haversineMetres(
  fromLat: number,
  fromLng: number,
  toLat: number,
  toLng: number,
): number {
  const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;
  const deltaLat = toRadians(toLat - fromLat);
  const deltaLng = toRadians(toLng - fromLng);

  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(toRadians(fromLat)) * Math.cos(toRadians(toLat)) * Math.sin(deltaLng / 2) ** 2;

  return Math.round(EARTH_RADIUS_METRES * 2 * Math.asin(Math.sqrt(a)));
}

/** Builds a URL-safe slug, transliterating nothing and stripping the rest. */
export function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 140);
}

@Injectable()
export class SearchRestaurantsUseCase {
  constructor(
    private readonly restaurants: RestaurantRepository,
    private readonly hours: OpeningHoursService,
  ) {}

  async execute(query: SearchRestaurantsQueryDto): Promise<PaginatedResult<RestaurantDto>> {
    const orderBy = buildOrderBy(query.sortBy, query.sortOrder, RESTAURANT_SORT_FIELDS, 'rating');

    const near =
      query.latitude !== undefined && query.longitude !== undefined
        ? { latitude: query.latitude, longitude: query.longitude }
        : undefined;

    const result = await this.restaurants.findMany({
      page: query.page,
      limit: query.limit,
      orderBy,
      search: query.search,
      cityId: query.cityId,
      zoneId: query.zoneId,
      categorySlug: query.category,
      priceRange: query.priceRange,
      minRating: query.minRating,
      acceptingOnly: query.acceptingOnly,
      near,
      // Customers only ever see approved listings; pending, rejected and
      // suspended restaurants are invisible to the public search.
      status: RestaurantStatus.ACTIVE,
    });

    return {
      items: result.items.map((restaurant) => this.present(restaurant, near)),
      meta: result.meta,
    };
  }

  private present(
    restaurant: RestaurantWithRelations,
    near?: { latitude: number; longitude: number },
  ): RestaurantDto {
    return toRestaurantDto(restaurant, {
      openState: this.hours.evaluate(restaurant.hours ?? []),
      distanceMeters: near
        ? haversineMetres(near.latitude, near.longitude, restaurant.latitude, restaurant.longitude)
        : undefined,
    });
  }
}

@Injectable()
export class GetRestaurantUseCase {
  constructor(
    private readonly restaurants: RestaurantRepository,
    private readonly hours: OpeningHoursService,
  ) {}

  /** Public detail view, addressed by slug so URLs stay readable. */
  async bySlug(slug: string): Promise<RestaurantDto> {
    const restaurant = await this.restaurants.findBySlug(slug);

    if (!restaurant || restaurant.status !== RestaurantStatus.ACTIVE) {
      throw new ResourceNotFoundException('Restaurant', slug);
    }

    return toRestaurantDto(restaurant, {
      openState: this.hours.evaluate(restaurant.hours ?? []),
    });
  }

  /**
   * Owner or staff view. Returns the private fields, and is the only path that
   * can see a listing which is not yet approved.
   */
  async byId(id: string, actor: AuthenticatedUser): Promise<RestaurantAdminDto> {
    const restaurant = await this.restaurants.findById(id, true);

    if (!restaurant) {
      throw new ResourceNotFoundException('Restaurant', id);
    }

    assertCanManage(restaurant, actor);

    return toRestaurantDto(restaurant, {
      openState: this.hours.evaluate(restaurant.hours ?? []),
      includePrivate: true,
    }) as RestaurantAdminDto;
  }
}

@Injectable()
export class ListRestaurantsAdminUseCase {
  constructor(
    private readonly restaurants: RestaurantRepository,
    private readonly hours: OpeningHoursService,
  ) {}

  async execute(
    query: ListRestaurantsAdminQueryDto,
    /** Set for owners, so they only ever see their own listings. */
    forceOwnerId?: string,
  ): Promise<PaginatedResult<RestaurantAdminDto>> {
    const orderBy = buildOrderBy(
      query.sortBy,
      query.sortOrder,
      RESTAURANT_SORT_FIELDS,
      'createdAt',
    );

    const result = await this.restaurants.findMany({
      page: query.page,
      limit: query.limit,
      orderBy,
      search: query.search,
      cityId: query.cityId,
      zoneId: query.zoneId,
      categorySlug: query.category,
      priceRange: query.priceRange,
      minRating: query.minRating,
      status: query.status,
      ownerId: forceOwnerId ?? query.ownerId,
      includeDeleted: query.includeDeleted,
    });

    return {
      items: result.items.map(
        (restaurant) =>
          toRestaurantDto(restaurant, {
            openState: this.hours.evaluate(restaurant.hours ?? []),
            includePrivate: true,
          }) as RestaurantAdminDto,
      ),
      meta: result.meta,
    };
  }
}

@Injectable()
export class RegisterRestaurantUseCase {
  constructor(
    private readonly restaurants: RestaurantRepository,
    private readonly categories: RestaurantCategoryRepository,
    private readonly addresses: AddressRepository,
  ) {}

  async execute(ownerId: string, dto: RegisterRestaurantDto): Promise<RestaurantAdminDto> {
    if ((await this.restaurants.countForOwner(ownerId)) >= MAX_RESTAURANTS_PER_OWNER) {
      throw new BusinessRuleViolationException(
        `An owner may list at most ${MAX_RESTAURANTS_PER_OWNER} restaurants.`,
      );
    }

    const found = await this.categories.findManyByIds(dto.categoryIds);

    if (found.length !== dto.categoryIds.length) {
      throw new BusinessRuleViolationException('One or more category ids do not exist.');
    }

    // The zone is derived from the coordinates, never taken from the request:
    // it decides which customers can see this restaurant at all.
    const zone = await this.addresses.resolveZone(dto.latitude, dto.longitude);

    if (!zone) {
      throw new BusinessRuleViolationException(
        'This location is outside our service area. We currently operate in Pabbi, Nowshera and Peshawar.',
      );
    }

    const slug = await this.uniqueSlug(dto.name, zone.name);

    const restaurant = await this.restaurants.create({
      ownerId,
      name: dto.name,
      nameUr: dto.nameUr ?? null,
      slug,
      description: dto.description ?? null,
      phone: dto.phone,
      email: dto.email ?? null,
      cityId: zone.cityId,
      zoneId: zone.id,
      addressLine: dto.addressLine,
      landmark: dto.landmark ?? null,
      latitude: dto.latitude,
      longitude: dto.longitude,
      priceRange: dto.priceRange,
      minOrderAmount: dto.minOrderAmount,
      avgPreparationMinutes: dto.avgPreparationMinutes,
      deliveryRadiusMeters: dto.deliveryRadiusMeters,
      categoryIds: dto.categoryIds,
    });

    return toRestaurantDto(restaurant, { includePrivate: true }) as RestaurantAdminDto;
  }

  /** Appends the zone name, then a counter, until the slug is free. */
  private async uniqueSlug(name: string, zoneName: string): Promise<string> {
    const base = slugify(name);

    if (!(await this.restaurants.slugExists(base))) {
      return base;
    }

    const withZone = `${base}-${slugify(zoneName)}`;

    if (!(await this.restaurants.slugExists(withZone))) {
      return withZone;
    }

    for (let suffix = 2; suffix < 100; suffix += 1) {
      const candidate = `${withZone}-${suffix}`;
      if (!(await this.restaurants.slugExists(candidate))) {
        return candidate;
      }
    }

    throw new ResourceConflictException(
      'Could not generate a unique address for this restaurant name.',
    );
  }
}

@Injectable()
export class UpdateRestaurantUseCase {
  constructor(
    private readonly restaurants: RestaurantRepository,
    private readonly categories: RestaurantCategoryRepository,
    private readonly addresses: AddressRepository,
  ) {}

  async execute(
    id: string,
    dto: UpdateRestaurantDto,
    actor: AuthenticatedUser,
  ): Promise<RestaurantAdminDto> {
    const existing = await this.restaurants.findById(id);

    if (!existing) {
      throw new ResourceNotFoundException('Restaurant', id);
    }

    assertCanManage(existing, actor);

    const patch: Parameters<RestaurantRepository['update']>[1] = { ...dto };

    if (dto.categoryIds) {
      const found = await this.categories.findManyByIds(dto.categoryIds);
      if (found.length !== dto.categoryIds.length) {
        throw new BusinessRuleViolationException('One or more category ids do not exist.');
      }
    }

    // Latitude and longitude are only meaningful together — a half-move would
    // place the restaurant somewhere neither the old nor the new location.
    if ((dto.latitude === undefined) !== (dto.longitude === undefined)) {
      throw new BusinessRuleViolationException('latitude and longitude must be updated together.');
    }

    if (dto.latitude !== undefined && dto.longitude !== undefined) {
      const zone = await this.addresses.resolveZone(dto.latitude, dto.longitude);

      if (!zone) {
        throw new BusinessRuleViolationException('That location is outside our service area.');
      }

      patch.cityId = zone.cityId;
      patch.zoneId = zone.id;
    }

    return toRestaurantDto(await this.restaurants.update(id, patch), {
      includePrivate: true,
    }) as RestaurantAdminDto;
  }
}

@Injectable()
export class DeleteRestaurantUseCase {
  constructor(private readonly restaurants: RestaurantRepository) {}

  async execute(id: string, actor: AuthenticatedUser): Promise<{ message: string }> {
    const existing = await this.restaurants.findById(id);

    if (!existing) {
      throw new ResourceNotFoundException('Restaurant', id);
    }

    assertCanManage(existing, actor);

    // Soft delete: orders and reviews reference this restaurant and must keep
    // resolving for order history and payouts.
    await this.restaurants.softDelete(id);

    return { message: 'Restaurant removed.' };
  }
}

/**
 * Owners may act only on their own restaurants; staff with the relevant
 * permission may act on any.
 *
 * Throws 404 rather than 403 for a restaurant belonging to someone else —
 * confirming that an id exists is itself a disclosure.
 */
export function assertCanManage(
  restaurant: { id: string; ownerId: string },
  actor: AuthenticatedUser,
): void {
  // Staff is decided by moderation capabilities, never by `restaurants.update`.
  // Vendor owners legitimately hold that permission for their *own* listings,
  // so treating it as a staff marker would let any vendor edit any other
  // vendor's restaurant. Approval and suspension are staff-only by design.
  const isStaff =
    actor.role === UserRole.ADMIN ||
    actor.role === UserRole.SUPER_ADMIN ||
    actor.permissions.includes('restaurants.approve') ||
    actor.permissions.includes('restaurants.suspend');

  if (isStaff) {
    return;
  }

  if (actor.role === UserRole.VENDOR_STAFF) {
    // 404 rather than 403 for another vendor's restaurant: confirming that an
    // id exists is itself a disclosure.
    if (actor.staffRestaurantId !== restaurant.id) {
      throw new ResourceNotFoundException('Restaurant');
    }
    return;
  }

  if (actor.role !== UserRole.VENDOR_OWNER) {
    throw new ForbiddenOperationException('Only a vendor may manage a restaurant.');
  }

  // 404 rather than 403 for someone else's restaurant: confirming that an id
  // exists is itself a disclosure.
  if (restaurant.ownerId !== actor.id) {
    throw new ResourceNotFoundException('Restaurant');
  }
}
