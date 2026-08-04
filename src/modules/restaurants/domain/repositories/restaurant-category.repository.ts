import type { Prisma, RestaurantCategory } from '@prisma/client';

import type { PaginatedResult } from '@/common/interfaces/paginated-result.interface';

export interface ListCategoriesFilter {
  page: number;
  limit: number;
  orderBy: Prisma.RestaurantCategoryOrderByWithRelationInput;
  search?: string;
  activeOnly?: boolean;
}

export interface CategoryInput {
  name: string;
  nameUr?: string | null;
  slug: string;
  iconUrl?: string | null;
  sortOrder?: number;
  isActive?: boolean;
}

/** Cuisine categories are a separate aggregate, shared across restaurants. */
export abstract class RestaurantCategoryRepository {
  abstract findMany(filter: ListCategoriesFilter): Promise<PaginatedResult<RestaurantCategory>>;
  abstract findById(id: string): Promise<RestaurantCategory | null>;
  abstract findBySlug(slug: string): Promise<RestaurantCategory | null>;
  abstract findManyByIds(ids: string[]): Promise<RestaurantCategory[]>;
  abstract slugExists(slug: string, excludeId?: string): Promise<boolean>;
  abstract create(input: CategoryInput): Promise<RestaurantCategory>;
  abstract update(id: string, input: Partial<CategoryInput>): Promise<RestaurantCategory>;
  abstract delete(id: string): Promise<void>;
  abstract countRestaurants(categoryId: string): Promise<number>;
}
