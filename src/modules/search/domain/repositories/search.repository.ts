import type { PriceRange } from '@prisma/client';

import type { PaginatedResult } from '@/common/interfaces/paginated-result.interface';

export interface GeoPoint {
  latitude: number;
  longitude: number;
}

export interface RestaurantSearchFilter {
  term?: string;
  cityId?: string;
  zoneId?: string;
  categorySlug?: string;
  priceRange?: PriceRange;
  minRating?: number;
  near?: GeoPoint;
  /** Metres. Ignored unless `near` is supplied. */
  radiusMeters?: number;
  openNowOnly?: boolean;
  page: number;
  limit: number;
  sort: 'relevance' | 'rating' | 'distance' | 'preparation';
}

export interface RestaurantSearchHit {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  coverUrl: string | null;
  description: string | null;
  rating: number;
  ratingCount: number;
  priceRange: PriceRange;
  minOrderAmount: number;
  avgPreparationMinutes: number;
  cityName: string;
  zoneName: string;
  categories: string[];
  isAcceptingOrders: boolean;
  distanceMeters: number | null;
  /** `ts_rank` score; zero when the query had no text term. */
  relevance: number;
}

export interface FoodSearchFilter {
  term?: string;
  restaurantId?: string;
  categorySlug?: string;
  isVegetarian?: boolean;
  maxPrice?: number;
  minPrice?: number;
  near?: GeoPoint;
  radiusMeters?: number;
  page: number;
  limit: number;
  sort: 'relevance' | 'price_asc' | 'price_desc' | 'rating';
}

export interface FoodSearchHit {
  id: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  basePrice: number;
  discountedPrice: number | null;
  effectivePrice: number;
  isVegetarian: boolean;
  spiceLevel: string;
  rating: number;
  ratingCount: number;
  restaurantId: string;
  restaurantName: string;
  restaurantSlug: string;
  restaurantRating: number;
  distanceMeters: number | null;
  relevance: number;
}

export interface CategoryHit {
  id: string;
  name: string;
  slug: string;
  iconUrl: string | null;
  restaurantCount: number;
}

export interface TrendingHit {
  restaurantId: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  rating: number;
  /** Delivered orders inside the trending window. */
  recentOrders: number;
}

export interface PopularFoodHit {
  id: string;
  name: string;
  imageUrl: string | null;
  effectivePrice: number;
  rating: number;
  ratingCount: number;
  restaurantName: string;
  restaurantSlug: string;
  orderCount: number;
}

export interface AutocompleteHit {
  type: 'restaurant' | 'dish' | 'category';
  id: string;
  label: string;
  /** Slug for restaurants and categories; the restaurant slug for a dish. */
  slug: string;
  imageUrl: string | null;
  /** Trigram similarity, 0–1. Used only for ordering. */
  score: number;
}

/**
 * Read-only search port.
 *
 * These queries combine full-text ranking, geo distance and aggregate counts in
 * ways Prisma's query builder cannot express, so the implementation is raw SQL.
 * Keeping that behind this interface means the rest of the module never sees it.
 */
export abstract class SearchRepository {
  abstract searchRestaurants(
    filter: RestaurantSearchFilter,
  ): Promise<PaginatedResult<RestaurantSearchHit>>;
  abstract searchFood(filter: FoodSearchFilter): Promise<PaginatedResult<FoodSearchHit>>;
  abstract searchCategories(term: string | undefined, limit: number): Promise<CategoryHit[]>;
  abstract trending(windowDays: number, limit: number, cityId?: string): Promise<TrendingHit[]>;
  abstract popularFood(limit: number, cityId?: string): Promise<PopularFoodHit[]>;
  abstract autocomplete(term: string, limit: number): Promise<AutocompleteHit[]>;
}
