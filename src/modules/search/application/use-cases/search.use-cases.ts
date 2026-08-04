import { Injectable } from '@nestjs/common';

import type { PaginatedResult } from '@/common/interfaces/paginated-result.interface';

import {
  SearchRepository,
  type AutocompleteHit,
  type CategoryHit,
  type FoodSearchHit,
  type GeoPoint,
  type PopularFoodHit,
  type RestaurantSearchHit,
  type TrendingHit,
} from '../../domain/repositories/search.repository';
import { SearchCacheService } from '../../infrastructure/cache/search-cache.service';
import type {
  AutocompleteDto,
  NearbySearchDto,
  PopularDto,
  SearchCategoriesDto,
  SearchFoodDto,
  SearchRestaurantsDto,
  TrendingDto,
} from '../dto/search-query.dto';
import type { GlobalSearchDto } from '../dto/search-response.dto';

/** Coordinates are only used when both halves are present. */
function toGeoPoint(latitude?: number, longitude?: number): GeoPoint | undefined {
  return latitude !== undefined && longitude !== undefined ? { latitude, longitude } : undefined;
}

@Injectable()
export class SearchRestaurantsUseCase {
  constructor(
    private readonly search: SearchRepository,
    private readonly cache: SearchCacheService,
  ) {}

  execute(dto: SearchRestaurantsDto): Promise<PaginatedResult<RestaurantSearchHit>> {
    const near = toGeoPoint(dto.latitude, dto.longitude);

    return this.cache.remember('search', { kind: 'restaurants', ...dto }, () =>
      this.search.searchRestaurants({
        term: dto.q,
        cityId: dto.cityId,
        zoneId: dto.zoneId,
        categorySlug: dto.category,
        priceRange: dto.priceRange,
        minRating: dto.minRating,
        openNowOnly: dto.openNow,
        near,
        radiusMeters: dto.radiusMeters,
        page: dto.page,
        limit: dto.limit,
        sort: dto.sort ?? 'relevance',
      }),
    );
  }
}

@Injectable()
export class SearchFoodUseCase {
  constructor(
    private readonly search: SearchRepository,
    private readonly cache: SearchCacheService,
  ) {}

  execute(dto: SearchFoodDto): Promise<PaginatedResult<FoodSearchHit>> {
    const near = toGeoPoint(dto.latitude, dto.longitude);

    return this.cache.remember('search', { kind: 'food', ...dto }, () =>
      this.search.searchFood({
        term: dto.q,
        restaurantId: dto.restaurantId,
        categorySlug: dto.category,
        isVegetarian: dto.isVegetarian,
        minPrice: dto.minPrice,
        maxPrice: dto.maxPrice,
        near,
        radiusMeters: dto.radiusMeters,
        page: dto.page,
        limit: dto.limit,
        sort: dto.sort ?? 'relevance',
      }),
    );
  }
}

@Injectable()
export class SearchCategoriesUseCase {
  constructor(
    private readonly search: SearchRepository,
    private readonly cache: SearchCacheService,
  ) {}

  execute(dto: SearchCategoriesDto): Promise<CategoryHit[]> {
    return this.cache.remember('categories', { ...dto }, () =>
      this.search.searchCategories(dto.q, dto.limit ?? 20),
    );
  }
}

@Injectable()
export class NearbySearchUseCase {
  constructor(
    private readonly search: SearchRepository,
    private readonly cache: SearchCacheService,
  ) {}

  /**
   * Restaurants that can deliver to a point, nearest first.
   *
   * Cached briefly and keyed on rounded coordinates: two customers a few metres
   * apart get the same answer, so rounding to roughly 100 m turns thousands of
   * near-identical cache keys into one useful entry.
   */
  execute(dto: NearbySearchDto): Promise<PaginatedResult<RestaurantSearchHit>> {
    const latitude = Number(dto.latitude.toFixed(3));
    const longitude = Number(dto.longitude.toFixed(3));
    const limit = dto.limit ?? 20;

    return this.cache.remember(
      'nearby',
      { latitude, longitude, radius: dto.radiusMeters ?? 15000, limit },
      () =>
        this.search.searchRestaurants({
          near: { latitude: dto.latitude, longitude: dto.longitude },
          radiusMeters: dto.radiusMeters,
          page: 1,
          limit,
          sort: 'distance',
        }),
    );
  }
}

@Injectable()
export class TrendingUseCase {
  constructor(
    private readonly search: SearchRepository,
    private readonly cache: SearchCacheService,
  ) {}

  execute(dto: TrendingDto): Promise<TrendingHit[]> {
    const days = dto.days ?? 7;
    const limit = dto.limit ?? 10;

    return this.cache.remember('trending', { days, limit, cityId: dto.cityId }, () =>
      this.search.trending(days, limit, dto.cityId),
    );
  }
}

@Injectable()
export class PopularUseCase {
  constructor(
    private readonly search: SearchRepository,
    private readonly cache: SearchCacheService,
  ) {}

  execute(dto: PopularDto): Promise<PopularFoodHit[]> {
    const limit = dto.limit ?? 10;

    return this.cache.remember('popular', { limit, cityId: dto.cityId }, () =>
      this.search.popularFood(limit, dto.cityId),
    );
  }
}

@Injectable()
export class AutocompleteUseCase {
  constructor(
    private readonly search: SearchRepository,
    private readonly cache: SearchCacheService,
  ) {}

  /**
   * Suggestions across restaurants, dishes and categories.
   *
   * This fires on nearly every keystroke, so it is the most cache-sensitive
   * endpoint in the module. The term is lower-cased before keying so "Kar",
   * "kar" and "KAR" share one entry.
   */
  execute(dto: AutocompleteDto): Promise<AutocompleteHit[]> {
    const term = dto.q.toLowerCase();
    const limit = dto.limit ?? 10;

    return this.cache.remember('autocomplete', { term, limit }, () =>
      this.search.autocomplete(term, limit),
    );
  }
}

@Injectable()
export class GlobalSearchUseCase {
  constructor(
    private readonly search: SearchRepository,
    private readonly cache: SearchCacheService,
  ) {}

  /**
   * One call powering the combined results screen.
   *
   * The three queries are issued together rather than sequentially: they are
   * independent, so running them in series would make the endpoint as slow as
   * their sum instead of their slowest.
   */
  execute(dto: SearchRestaurantsDto): Promise<GlobalSearchDto> {
    const near = toGeoPoint(dto.latitude, dto.longitude);

    return this.cache.remember('search', { kind: 'global', ...dto }, async () => {
      const [restaurants, dishes, categories] = await Promise.all([
        this.search.searchRestaurants({
          term: dto.q,
          cityId: dto.cityId,
          near,
          radiusMeters: dto.radiusMeters,
          page: 1,
          limit: 5,
          sort: 'relevance',
        }),
        this.search.searchFood({
          term: dto.q,
          near,
          radiusMeters: dto.radiusMeters,
          page: 1,
          limit: 5,
          sort: 'relevance',
        }),
        this.search.searchCategories(dto.q, 5),
      ]);

      return {
        restaurants: restaurants.items,
        dishes: dishes.items,
        categories,
        totalResults: restaurants.meta.total + dishes.meta.total + categories.length,
      };
    });
  }
}
