import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import type { PaginatedResult } from '@/common/interfaces/paginated-result.interface';
import { paginate } from '@/common/utils/pagination.util';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';

import {
  FavoriteRepository,
  type FavoriteWithTarget,
  type ListFavoritesFilter,
} from '../../domain/repositories/favorite.repository';

/** Only the fields the favorites list renders — not whole restaurant rows. */
const TARGET_SELECT = {
  restaurant: {
    select: {
      id: true,
      name: true,
      slug: true,
      logoUrl: true,
      rating: true,
      ratingCount: true,
      status: true,
    },
  },
  menuItem: {
    select: { id: true, name: true, imageUrl: true, basePrice: true, status: true },
  },
} satisfies Prisma.FavoriteInclude;

@Injectable()
export class PrismaFavoriteRepository extends FavoriteRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async findMany(filter: ListFavoritesFilter): Promise<PaginatedResult<FavoriteWithTarget>> {
    const where: Prisma.FavoriteWhereInput = {
      userId: filter.userId,
      ...(filter.target === 'restaurant' && { restaurantId: { not: null } }),
      ...(filter.target === 'menuItem' && { menuItemId: { not: null } }),
    };

    const [total, items] = await this.prisma.$transaction([
      this.prisma.favorite.count({ where }),
      this.prisma.favorite.findMany({
        where,
        include: TARGET_SELECT,
        orderBy: filter.orderBy,
        skip: (filter.page - 1) * filter.limit,
        take: filter.limit,
      }),
    ]);

    return paginate(items, total, filter.page, filter.limit);
  }

  async addRestaurant(userId: string, restaurantId: string): Promise<FavoriteWithTarget> {
    return this.prisma.favorite.create({
      data: { userId, restaurantId },
      include: TARGET_SELECT,
    });
  }

  async addMenuItem(userId: string, menuItemId: string): Promise<FavoriteWithTarget> {
    return this.prisma.favorite.create({
      data: { userId, menuItemId },
      include: TARGET_SELECT,
    });
  }

  async removeRestaurant(userId: string, restaurantId: string): Promise<boolean> {
    const result = await this.prisma.favorite.deleteMany({ where: { userId, restaurantId } });
    return result.count > 0;
  }

  async removeMenuItem(userId: string, menuItemId: string): Promise<boolean> {
    const result = await this.prisma.favorite.deleteMany({ where: { userId, menuItemId } });
    return result.count > 0;
  }

  async restaurantExists(restaurantId: string): Promise<boolean> {
    const found = await this.prisma.restaurant.findFirst({
      where: { id: restaurantId, deletedAt: null },
      select: { id: true },
    });

    return found !== null;
  }

  async menuItemExists(menuItemId: string): Promise<boolean> {
    const found = await this.prisma.menuItem.findFirst({
      where: { id: menuItemId, deletedAt: null },
      select: { id: true },
    });

    return found !== null;
  }
}
