import { Injectable } from '@nestjs/common';
import type { MenuCategory, Prisma } from '@prisma/client';

import type { PaginatedResult } from '@/common/interfaces/paginated-result.interface';
import { paginate } from '@/common/utils/pagination.util';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';

import {
  MenuRepository,
  type ListMenusFilter,
  type MenuCategoryInput,
  type MenuInput,
  type MenuWithCategories,
} from '../../domain/repositories/menu.repository';

/** Categories carry a live item count so the owner UI needs no second query. */
const WITH_CATEGORIES = {
  categories: {
    orderBy: { sortOrder: 'asc' },
    include: { _count: { select: { items: { where: { deletedAt: null } } } } },
  },
} satisfies Prisma.MenuInclude;

@Injectable()
export class PrismaMenuRepository extends MenuRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async findMany(filter: ListMenusFilter): Promise<PaginatedResult<MenuWithCategories>> {
    const where: Prisma.MenuWhereInput = {
      restaurantId: filter.restaurantId,
      ...(filter.activeOnly === true && { isActive: true }),
    };

    const [total, items] = await this.prisma.$transaction([
      this.prisma.menu.count({ where }),
      this.prisma.menu.findMany({
        where,
        include: WITH_CATEGORIES,
        orderBy: filter.orderBy,
        skip: (filter.page - 1) * filter.limit,
        take: filter.limit,
      }),
    ]);

    return paginate(items, total, filter.page, filter.limit);
  }

  async findById(id: string): Promise<MenuWithCategories | null> {
    return this.prisma.menu.findUnique({ where: { id }, include: WITH_CATEGORIES });
  }

  async nameExists(restaurantId: string, name: string, excludeId?: string): Promise<boolean> {
    const found = await this.prisma.menu.findFirst({
      where: { restaurantId, name, ...(excludeId && { id: { not: excludeId } }) },
      select: { id: true },
    });

    return found !== null;
  }

  async create(restaurantId: string, input: MenuInput): Promise<MenuWithCategories> {
    return this.prisma.menu.create({
      data: { restaurantId, ...input },
      include: WITH_CATEGORIES,
    });
  }

  async update(id: string, input: Partial<MenuInput>): Promise<MenuWithCategories> {
    return this.prisma.menu.update({ where: { id }, data: input, include: WITH_CATEGORIES });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.menu.delete({ where: { id } });
  }

  async countItems(menuId: string): Promise<number> {
    return this.prisma.menuItem.count({
      where: { menuCategory: { menuId }, deletedAt: null },
    });
  }

  // ── Categories ──

  async findCategoryById(id: string): Promise<MenuCategory | null> {
    return this.prisma.menuCategory.findUnique({ where: { id } });
  }

  async categoryNameExists(menuId: string, name: string, excludeId?: string): Promise<boolean> {
    const found = await this.prisma.menuCategory.findFirst({
      where: { menuId, name, ...(excludeId && { id: { not: excludeId } }) },
      select: { id: true },
    });

    return found !== null;
  }

  async createCategory(menuId: string, input: MenuCategoryInput): Promise<MenuCategory> {
    return this.prisma.menuCategory.create({ data: { menuId, ...input } });
  }

  async updateCategory(id: string, input: Partial<MenuCategoryInput>): Promise<MenuCategory> {
    return this.prisma.menuCategory.update({ where: { id }, data: input });
  }

  async deleteCategory(id: string): Promise<void> {
    await this.prisma.menuCategory.delete({ where: { id } });
  }

  async countCategoryItems(categoryId: string): Promise<number> {
    return this.prisma.menuItem.count({ where: { menuCategoryId: categoryId, deletedAt: null } });
  }

  async reorderCategories(menuId: string, orderedIds: string[]): Promise<MenuCategory[]> {
    await this.prisma.$transaction(
      orderedIds.map((id, index) =>
        this.prisma.menuCategory.update({ where: { id }, data: { sortOrder: index } }),
      ),
    );

    return this.prisma.menuCategory.findMany({
      where: { menuId },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async findPublicMenu(restaurantId: string): Promise<MenuWithCategories[]> {
    // Only active menus and sections reach the storefront; a section the owner
    // has switched off must not appear even if it still holds dishes.
    return this.prisma.menu.findMany({
      where: { restaurantId, isActive: true },
      orderBy: { sortOrder: 'asc' },
      include: {
        categories: {
          where: { isActive: true },
          orderBy: { sortOrder: 'asc' },
          include: { _count: { select: { items: { where: { deletedAt: null } } } } },
        },
      },
    });
  }
}
