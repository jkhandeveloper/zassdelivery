import { Injectable } from '@nestjs/common';

import {
  BusinessRuleViolationException,
  ResourceConflictException,
  ResourceNotFoundException,
} from '@/common/exceptions/domain.exception';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import type { PaginatedResult } from '@/common/interfaces/paginated-result.interface';
import { buildOrderBy } from '@/common/utils/pagination.util';
import { assertCanManage } from '@/modules/restaurants/application/use-cases/restaurants.use-cases';
import { RestaurantRepository } from '@/modules/restaurants/domain/repositories/restaurant.repository';

import { MenuRepository } from '../../domain/repositories/menu.repository';
import { MENU_SORT_FIELDS, type ListMenusQueryDto } from '../dto/menu-query.dto';
import {
  toMenuCategoryDto,
  toMenuDto,
  type MenuCategoryDto,
  type MenuDto,
} from '../dto/menu-response.dto';
import type {
  CreateMenuCategoryDto,
  CreateMenuDto,
  ReorderDto,
  UpdateMenuCategoryDto,
  UpdateMenuDto,
} from '../dto/menu.dto';

/**
 * Loads a restaurant and proves the caller may manage it.
 *
 * Menus, categories, items, variants and add-ons all hang off a restaurant, so
 * every write in this module funnels through here. Centralising it means a new
 * endpoint cannot accidentally skip the ownership check.
 */
@Injectable()
export class MenuOwnershipGuardService {
  constructor(private readonly restaurants: RestaurantRepository) {}

  async assertRestaurant(restaurantId: string, actor: AuthenticatedUser): Promise<void> {
    const restaurant = await this.restaurants.findById(restaurantId, true);

    if (!restaurant) {
      throw new ResourceNotFoundException('Restaurant', restaurantId);
    }

    assertCanManage(restaurant, actor);
  }
}

@Injectable()
export class ListMenusUseCase {
  constructor(
    private readonly menus: MenuRepository,
    private readonly ownership: MenuOwnershipGuardService,
  ) {}

  async execute(
    restaurantId: string,
    query: ListMenusQueryDto,
    actor: AuthenticatedUser,
  ): Promise<PaginatedResult<MenuDto>> {
    // This view returns inactive menus, which are unpublished business data.
    // Without an ownership check any signed-in vendor could read a competitor's
    // draft menu simply by supplying its restaurant id.
    await this.ownership.assertRestaurant(restaurantId, actor);

    const orderBy = buildOrderBy(query.sortBy, query.sortOrder, MENU_SORT_FIELDS, 'sortOrder');

    const result = await this.menus.findMany({
      restaurantId,
      page: query.page,
      limit: query.limit,
      orderBy,
      activeOnly: query.activeOnly,
    });

    return { items: result.items.map(toMenuDto), meta: result.meta };
  }
}

@Injectable()
export class CreateMenuUseCase {
  constructor(
    private readonly menus: MenuRepository,
    private readonly ownership: MenuOwnershipGuardService,
  ) {}

  async execute(
    restaurantId: string,
    dto: CreateMenuDto,
    actor: AuthenticatedUser,
  ): Promise<MenuDto> {
    await this.ownership.assertRestaurant(restaurantId, actor);

    if (await this.menus.nameExists(restaurantId, dto.name)) {
      throw new ResourceConflictException(
        `This restaurant already has a menu named "${dto.name}".`,
      );
    }

    return toMenuDto(await this.menus.create(restaurantId, dto));
  }
}

@Injectable()
export class UpdateMenuUseCase {
  constructor(
    private readonly menus: MenuRepository,
    private readonly ownership: MenuOwnershipGuardService,
  ) {}

  async execute(menuId: string, dto: UpdateMenuDto, actor: AuthenticatedUser): Promise<MenuDto> {
    const menu = await this.menus.findById(menuId);

    if (!menu) {
      throw new ResourceNotFoundException('Menu', menuId);
    }

    await this.ownership.assertRestaurant(menu.restaurantId, actor);

    if (dto.name && (await this.menus.nameExists(menu.restaurantId, dto.name, menuId))) {
      throw new ResourceConflictException(
        `This restaurant already has a menu named "${dto.name}".`,
      );
    }

    return toMenuDto(await this.menus.update(menuId, dto));
  }
}

@Injectable()
export class DeleteMenuUseCase {
  constructor(
    private readonly menus: MenuRepository,
    private readonly ownership: MenuOwnershipGuardService,
  ) {}

  async execute(menuId: string, actor: AuthenticatedUser): Promise<{ message: string }> {
    const menu = await this.menus.findById(menuId);

    if (!menu) {
      throw new ResourceNotFoundException('Menu', menuId);
    }

    await this.ownership.assertRestaurant(menu.restaurantId, actor);

    const itemCount = await this.menus.countItems(menuId);

    // Deleting cascades to categories and their items, and those items are
    // referenced by past order lines. Deactivating hides the menu without
    // destroying anything.
    if (itemCount > 0) {
      throw new BusinessRuleViolationException(
        `This menu still contains ${itemCount} item(s). Deactivate it instead, or remove the items first.`,
      );
    }

    await this.menus.delete(menuId);

    return { message: 'Menu deleted.' };
  }
}

@Injectable()
export class CreateMenuCategoryUseCase {
  constructor(
    private readonly menus: MenuRepository,
    private readonly ownership: MenuOwnershipGuardService,
  ) {}

  async execute(
    menuId: string,
    dto: CreateMenuCategoryDto,
    actor: AuthenticatedUser,
  ): Promise<MenuCategoryDto> {
    const menu = await this.menus.findById(menuId);

    if (!menu) {
      throw new ResourceNotFoundException('Menu', menuId);
    }

    await this.ownership.assertRestaurant(menu.restaurantId, actor);

    if (await this.menus.categoryNameExists(menuId, dto.name)) {
      throw new ResourceConflictException(`This menu already has a section named "${dto.name}".`);
    }

    return toMenuCategoryDto(await this.menus.createCategory(menuId, dto));
  }
}

@Injectable()
export class UpdateMenuCategoryUseCase {
  constructor(
    private readonly menus: MenuRepository,
    private readonly ownership: MenuOwnershipGuardService,
  ) {}

  async execute(
    categoryId: string,
    dto: UpdateMenuCategoryDto,
    actor: AuthenticatedUser,
  ): Promise<MenuCategoryDto> {
    const category = await this.menus.findCategoryById(categoryId);

    if (!category) {
      throw new ResourceNotFoundException('Menu category', categoryId);
    }

    const menu = await this.menus.findById(category.menuId);

    if (!menu) {
      throw new ResourceNotFoundException('Menu', category.menuId);
    }

    await this.ownership.assertRestaurant(menu.restaurantId, actor);

    if (dto.name && (await this.menus.categoryNameExists(category.menuId, dto.name, categoryId))) {
      throw new ResourceConflictException(`This menu already has a section named "${dto.name}".`);
    }

    return toMenuCategoryDto(await this.menus.updateCategory(categoryId, dto));
  }
}

@Injectable()
export class DeleteMenuCategoryUseCase {
  constructor(
    private readonly menus: MenuRepository,
    private readonly ownership: MenuOwnershipGuardService,
  ) {}

  async execute(categoryId: string, actor: AuthenticatedUser): Promise<{ message: string }> {
    const category = await this.menus.findCategoryById(categoryId);

    if (!category) {
      throw new ResourceNotFoundException('Menu category', categoryId);
    }

    const menu = await this.menus.findById(category.menuId);

    if (!menu) {
      throw new ResourceNotFoundException('Menu', category.menuId);
    }

    await this.ownership.assertRestaurant(menu.restaurantId, actor);

    const itemCount = await this.menus.countCategoryItems(categoryId);

    if (itemCount > 0) {
      throw new BusinessRuleViolationException(
        `This section still contains ${itemCount} item(s). Move or remove them first.`,
      );
    }

    await this.menus.deleteCategory(categoryId);

    return { message: 'Menu section deleted.' };
  }
}

@Injectable()
export class ReorderMenuCategoriesUseCase {
  constructor(
    private readonly menus: MenuRepository,
    private readonly ownership: MenuOwnershipGuardService,
  ) {}

  async execute(
    menuId: string,
    dto: ReorderDto,
    actor: AuthenticatedUser,
  ): Promise<MenuCategoryDto[]> {
    const menu = await this.menus.findById(menuId);

    if (!menu) {
      throw new ResourceNotFoundException('Menu', menuId);
    }

    await this.ownership.assertRestaurant(menu.restaurantId, actor);

    const existingIds = new Set(menu.categories.map((category) => category.id));

    // A partial list would leave the omitted sections at stale positions and
    // render the menu in an order nobody chose.
    if (dto.ids.length !== existingIds.size) {
      throw new BusinessRuleViolationException(
        `Provide all ${existingIds.size} section ids in the desired order.`,
      );
    }

    const unknown = dto.ids.filter((id) => !existingIds.has(id));

    if (unknown.length > 0) {
      throw new BusinessRuleViolationException(
        `These sections do not belong to this menu: ${unknown.join(', ')}.`,
      );
    }

    return (await this.menus.reorderCategories(menuId, dto.ids)).map((category) =>
      toMenuCategoryDto(category),
    );
  }
}

@Injectable()
export class GetPublicMenuUseCase {
  constructor(private readonly menus: MenuRepository) {}

  /** The storefront menu: active menus and sections only. */
  async execute(restaurantId: string): Promise<MenuDto[]> {
    return (await this.menus.findPublicMenu(restaurantId)).map(toMenuDto);
  }
}
