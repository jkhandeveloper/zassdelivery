import type { Menu, MenuCategory, Prisma } from '@prisma/client';

import type { PaginatedResult } from '@/common/interfaces/paginated-result.interface';

export type MenuWithCategories = Menu & {
  categories: Array<MenuCategory & { _count: { items: number } }>;
};

export interface ListMenusFilter {
  restaurantId: string;
  page: number;
  limit: number;
  orderBy: Prisma.MenuOrderByWithRelationInput;
  activeOnly?: boolean;
}

export interface MenuInput {
  name: string;
  description?: string | null;
  sortOrder?: number;
  isActive?: boolean;
}

export interface MenuCategoryInput {
  name: string;
  nameUr?: string | null;
  description?: string | null;
  imageUrl?: string | null;
  sortOrder?: number;
  isActive?: boolean;
}

/**
 * Menu is an aggregate root; its categories have no meaning outside it, so they
 * are reached through this repository rather than getting one of their own.
 */
export abstract class MenuRepository {
  abstract findMany(filter: ListMenusFilter): Promise<PaginatedResult<MenuWithCategories>>;
  abstract findById(id: string): Promise<MenuWithCategories | null>;
  abstract nameExists(restaurantId: string, name: string, excludeId?: string): Promise<boolean>;
  abstract create(restaurantId: string, input: MenuInput): Promise<MenuWithCategories>;
  abstract update(id: string, input: Partial<MenuInput>): Promise<MenuWithCategories>;
  abstract delete(id: string): Promise<void>;
  abstract countItems(menuId: string): Promise<number>;

  // ── Categories ──
  abstract findCategoryById(id: string): Promise<MenuCategory | null>;
  abstract categoryNameExists(menuId: string, name: string, excludeId?: string): Promise<boolean>;
  abstract createCategory(menuId: string, input: MenuCategoryInput): Promise<MenuCategory>;
  abstract updateCategory(id: string, input: Partial<MenuCategoryInput>): Promise<MenuCategory>;
  abstract deleteCategory(id: string): Promise<void>;
  abstract countCategoryItems(categoryId: string): Promise<number>;
  abstract reorderCategories(menuId: string, orderedIds: string[]): Promise<MenuCategory[]>;

  /**
   * The whole published menu for a restaurant, nested for the storefront.
   * One query rather than a per-category fan-out.
   */
  abstract findPublicMenu(restaurantId: string): Promise<MenuWithCategories[]>;
}
