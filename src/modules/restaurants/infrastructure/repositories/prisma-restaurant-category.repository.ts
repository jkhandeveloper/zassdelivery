import { Injectable } from '@nestjs/common';
import type { Prisma, RestaurantCategory } from '@prisma/client';

import type { PaginatedResult } from '@/common/interfaces/paginated-result.interface';
import { paginate } from '@/common/utils/pagination.util';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';

import {
  RestaurantCategoryRepository,
  type CategoryInput,
  type ListCategoriesFilter,
} from '../../domain/repositories/restaurant-category.repository';

@Injectable()
export class PrismaRestaurantCategoryRepository extends RestaurantCategoryRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async findMany(filter: ListCategoriesFilter): Promise<PaginatedResult<RestaurantCategory>> {
    const where: Prisma.RestaurantCategoryWhereInput = {
      ...(filter.activeOnly === true && { isActive: true }),
      ...(filter.search !== undefined &&
        filter.search.length > 0 && {
          name: { contains: filter.search, mode: 'insensitive' },
        }),
    };

    const [total, items] = await this.prisma.$transaction([
      this.prisma.restaurantCategory.count({ where }),
      this.prisma.restaurantCategory.findMany({
        where,
        orderBy: filter.orderBy,
        skip: (filter.page - 1) * filter.limit,
        take: filter.limit,
      }),
    ]);

    return paginate(items, total, filter.page, filter.limit);
  }

  async findById(id: string): Promise<RestaurantCategory | null> {
    return this.prisma.restaurantCategory.findUnique({ where: { id } });
  }

  async findBySlug(slug: string): Promise<RestaurantCategory | null> {
    return this.prisma.restaurantCategory.findUnique({ where: { slug } });
  }

  async findManyByIds(ids: string[]): Promise<RestaurantCategory[]> {
    return this.prisma.restaurantCategory.findMany({ where: { id: { in: ids } } });
  }

  async slugExists(slug: string, excludeId?: string): Promise<boolean> {
    const found = await this.prisma.restaurantCategory.findFirst({
      where: { slug, ...(excludeId && { id: { not: excludeId } }) },
      select: { id: true },
    });

    return found !== null;
  }

  async create(input: CategoryInput): Promise<RestaurantCategory> {
    return this.prisma.restaurantCategory.create({ data: input });
  }

  async update(id: string, input: Partial<CategoryInput>): Promise<RestaurantCategory> {
    return this.prisma.restaurantCategory.update({ where: { id }, data: input });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.restaurantCategory.delete({ where: { id } });
  }

  async countRestaurants(categoryId: string): Promise<number> {
    return this.prisma.restaurantCategoryAssignment.count({ where: { categoryId } });
  }
}
