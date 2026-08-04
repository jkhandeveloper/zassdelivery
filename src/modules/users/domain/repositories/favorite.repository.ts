import type { Favorite, MenuItem, Prisma, Restaurant } from '@prisma/client';

import type { PaginatedResult } from '@/common/interfaces/paginated-result.interface';

/** A favorite joined with whichever target it points at. */
export type FavoriteWithTarget = Favorite & {
  restaurant: Pick<
    Restaurant,
    'id' | 'name' | 'slug' | 'logoUrl' | 'rating' | 'ratingCount' | 'status'
  > | null;
  menuItem: Pick<MenuItem, 'id' | 'name' | 'imageUrl' | 'basePrice' | 'status'> | null;
};

export interface ListFavoritesFilter {
  userId: string;
  page: number;
  limit: number;
  orderBy: Prisma.FavoriteOrderByWithRelationInput;
  /** Narrow to one kind of target. */
  target?: 'restaurant' | 'menuItem';
}

export abstract class FavoriteRepository {
  abstract findMany(filter: ListFavoritesFilter): Promise<PaginatedResult<FavoriteWithTarget>>;
  abstract addRestaurant(userId: string, restaurantId: string): Promise<FavoriteWithTarget>;
  abstract addMenuItem(userId: string, menuItemId: string): Promise<FavoriteWithTarget>;
  abstract removeRestaurant(userId: string, restaurantId: string): Promise<boolean>;
  abstract removeMenuItem(userId: string, menuItemId: string): Promise<boolean>;
  abstract restaurantExists(restaurantId: string): Promise<boolean>;
  abstract menuItemExists(menuItemId: string): Promise<boolean>;
}
