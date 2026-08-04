import { Injectable } from '@nestjs/common';

import {
  BusinessRuleViolationException,
  ResourceConflictException,
  ResourceNotFoundException,
} from '@/common/exceptions/domain.exception';
import type { PaginatedResult } from '@/common/interfaces/paginated-result.interface';
import { buildOrderBy } from '@/common/utils/pagination.util';

import {
  FavoriteRepository,
  type FavoriteWithTarget,
} from '../../domain/repositories/favorite.repository';
import type { CreateFavoriteDto, FavoriteDto } from '../dto/favorite.dto';
import { FAVORITE_SORT_FIELDS, type ListFavoritesQueryDto } from '../dto/user-query.dto';

function toFavoriteDto(favorite: FavoriteWithTarget): FavoriteDto {
  if (favorite.restaurant) {
    return {
      id: favorite.id,
      target: 'restaurant',
      item: {
        id: favorite.restaurant.id,
        name: favorite.restaurant.name,
        imageUrl: favorite.restaurant.logoUrl,
      },
      createdAt: favorite.createdAt,
    };
  }

  // The CHECK constraint guarantees exactly one target is set, so reaching here
  // means the row is a menu item.
  return {
    id: favorite.id,
    target: 'menuItem',
    item: {
      id: favorite.menuItem?.id ?? '',
      name: favorite.menuItem?.name ?? '',
      imageUrl: favorite.menuItem?.imageUrl ?? null,
    },
    createdAt: favorite.createdAt,
  };
}

@Injectable()
export class ListFavoritesUseCase {
  constructor(private readonly favorites: FavoriteRepository) {}

  async execute(
    userId: string,
    query: ListFavoritesQueryDto,
  ): Promise<PaginatedResult<FavoriteDto>> {
    const orderBy = buildOrderBy(query.sortBy, query.sortOrder, FAVORITE_SORT_FIELDS, 'createdAt');

    const result = await this.favorites.findMany({
      userId,
      page: query.page,
      limit: query.limit,
      orderBy,
      target: query.target,
    });

    return { items: result.items.map(toFavoriteDto), meta: result.meta };
  }
}

@Injectable()
export class AddFavoriteUseCase {
  constructor(private readonly favorites: FavoriteRepository) {}

  async execute(userId: string, dto: CreateFavoriteDto): Promise<FavoriteDto> {
    const hasRestaurant = Boolean(dto.restaurantId);
    const hasMenuItem = Boolean(dto.menuItemId);

    // Mirrors the favorites_exactly_one_target CHECK constraint, but fails with
    // a readable 422 instead of a database error.
    if (hasRestaurant === hasMenuItem) {
      throw new BusinessRuleViolationException(
        'Provide exactly one of restaurantId or menuItemId.',
      );
    }

    if (hasRestaurant) {
      const restaurantId = dto.restaurantId as string;

      if (!(await this.favorites.restaurantExists(restaurantId))) {
        throw new ResourceNotFoundException('Restaurant', restaurantId);
      }

      try {
        return toFavoriteDto(await this.favorites.addRestaurant(userId, restaurantId));
      } catch {
        // The unique index on (userId, restaurantId) is what actually prevents
        // duplicates under concurrent taps on the heart button.
        throw new ResourceConflictException('This restaurant is already in your favorites.');
      }
    }

    const menuItemId = dto.menuItemId as string;

    if (!(await this.favorites.menuItemExists(menuItemId))) {
      throw new ResourceNotFoundException('Menu item', menuItemId);
    }

    try {
      return toFavoriteDto(await this.favorites.addMenuItem(userId, menuItemId));
    } catch {
      throw new ResourceConflictException('This item is already in your favorites.');
    }
  }
}

@Injectable()
export class RemoveFavoriteUseCase {
  constructor(private readonly favorites: FavoriteRepository) {}

  async executeRestaurant(userId: string, restaurantId: string): Promise<{ message: string }> {
    const removed = await this.favorites.removeRestaurant(userId, restaurantId);

    if (!removed) {
      throw new ResourceNotFoundException('Favorite', restaurantId);
    }

    return { message: 'Removed from favorites.' };
  }

  async executeMenuItem(userId: string, menuItemId: string): Promise<{ message: string }> {
    const removed = await this.favorites.removeMenuItem(userId, menuItemId);

    if (!removed) {
      throw new ResourceNotFoundException('Favorite', menuItemId);
    }

    return { message: 'Removed from favorites.' };
  }
}
