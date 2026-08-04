import { Injectable } from '@nestjs/common';
import { MenuItemStatus } from '@prisma/client';

import {
  BusinessRuleViolationException,
  ResourceConflictException,
  ResourceNotFoundException,
} from '@/common/exceptions/domain.exception';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import type { PaginatedResult } from '@/common/interfaces/paginated-result.interface';
import { buildOrderBy } from '@/common/utils/pagination.util';

import {
  MenuItemRepository,
  type MenuItemWithRelations,
} from '../../domain/repositories/menu-item.repository';
import { MenuRepository } from '../../domain/repositories/menu.repository';
import { ItemAvailabilityService } from '../../domain/services/item-availability.service';
import { MENU_ITEM_SORT_FIELDS, type ListMenuItemsAdminQueryDto } from '../dto/menu-query.dto';
import {
  toItemImageDto,
  toMenuItemDto,
  type MenuItemAdminDto,
  type MenuItemDto,
  type MenuItemImageDto,
} from '../dto/menu-response.dto';
import type { AddMenuItemImageDto, CreateMenuItemDto, UpdateMenuItemDto } from '../dto/menu.dto';
import { MenuOwnershipGuardService } from './menus.use-cases';

const MAX_IMAGES_PER_ITEM = 8;

/** Shared presentation wiring so every read path evaluates availability identically. */
@Injectable()
export class MenuItemPresenter {
  constructor(private readonly availability: ItemAvailabilityService) {}

  present(item: MenuItemWithRelations, includePrivate = false): MenuItemDto | MenuItemAdminDto {
    return toMenuItemDto(item, {
      availability: this.availability.evaluate(item),
      variantAvailability: (variant) => this.availability.isVariantAvailable(variant),
      includePrivate,
    });
  }
}

@Injectable()
export class ListMenuItemsUseCase {
  constructor(
    private readonly items: MenuItemRepository,
    private readonly presenter: MenuItemPresenter,
    private readonly ownership: MenuOwnershipGuardService,
  ) {}

  /**
   * `actor` is supplied only by the management view. Its presence is what
   * unlocks hidden dishes and stock counts — and it is checked against the
   * restaurant first, so those operational details never leak to a vendor
   * browsing someone else's menu.
   */
  async execute(
    restaurantId: string,
    query: ListMenuItemsAdminQueryDto,
    actor?: AuthenticatedUser,
  ): Promise<PaginatedResult<MenuItemDto>> {
    const includePrivate = actor !== undefined;

    if (actor) {
      await this.ownership.assertRestaurant(restaurantId, actor);
    }

    const orderBy = buildOrderBy(query.sortBy, query.sortOrder, MENU_ITEM_SORT_FIELDS, 'sortOrder');

    const result = await this.items.findMany({
      restaurantId,
      page: query.page,
      limit: query.limit,
      orderBy,
      menuCategoryId: query.menuCategoryId,
      // Customers never see hidden dishes; the owner view passes its own filter.
      status: includePrivate ? query.status : (query.status ?? MenuItemStatus.AVAILABLE),
      search: query.search,
      isVegetarian: query.isVegetarian,
      spiceLevel: query.spiceLevel,
      minPrice: query.minPrice,
      maxPrice: query.maxPrice,
      featuredOnly: query.featuredOnly,
      lowStockOnly: includePrivate ? query.lowStockOnly : false,
      includeDeleted: includePrivate ? query.includeDeleted : false,
    });

    return {
      items: result.items.map((item) => this.presenter.present(item, includePrivate)),
      meta: result.meta,
    };
  }
}

@Injectable()
export class GetMenuItemUseCase {
  constructor(
    private readonly items: MenuItemRepository,
    private readonly presenter: MenuItemPresenter,
  ) {}

  async execute(id: string, includePrivate = false): Promise<MenuItemDto> {
    const item = await this.items.findById(id, includePrivate);

    if (!item) {
      throw new ResourceNotFoundException('Menu item', id);
    }

    // A hidden dish stays reachable to its owner but is invisible publicly.
    if (!includePrivate && item.status === MenuItemStatus.HIDDEN) {
      throw new ResourceNotFoundException('Menu item', id);
    }

    return this.presenter.present(item, includePrivate);
  }
}

@Injectable()
export class CreateMenuItemUseCase {
  constructor(
    private readonly items: MenuItemRepository,
    private readonly menus: MenuRepository,
    private readonly ownership: MenuOwnershipGuardService,
    private readonly presenter: MenuItemPresenter,
  ) {}

  async execute(dto: CreateMenuItemDto, actor: AuthenticatedUser): Promise<MenuItemAdminDto> {
    const category = await this.menus.findCategoryById(dto.menuCategoryId);

    if (!category) {
      throw new ResourceNotFoundException('Menu category', dto.menuCategoryId);
    }

    const menu = await this.menus.findById(category.menuId);

    if (!menu) {
      throw new ResourceNotFoundException('Menu', category.menuId);
    }

    await this.ownership.assertRestaurant(menu.restaurantId, actor);

    if (await this.items.nameExistsInCategory(dto.menuCategoryId, dto.name)) {
      throw new ResourceConflictException(
        `This section already contains a dish named "${dto.name}".`,
      );
    }

    assertPricing(dto.basePrice, dto.discountedPrice);
    assertAvailabilityWindow(dto.availableFrom, dto.availableTo);

    const item = await this.items.create({
      ...dto,
      // Denormalised from the menu so restaurant-wide item queries avoid a
      // two-level join on every request.
      restaurantId: menu.restaurantId,
      discountedPrice: dto.discountedPrice ?? null,
      calories: dto.calories ?? null,
      availableFrom: dto.availableFrom ?? null,
      availableTo: dto.availableTo ?? null,
    });

    return this.presenter.present(item, true) as MenuItemAdminDto;
  }
}

@Injectable()
export class UpdateMenuItemUseCase {
  constructor(
    private readonly items: MenuItemRepository,
    private readonly menus: MenuRepository,
    private readonly ownership: MenuOwnershipGuardService,
    private readonly presenter: MenuItemPresenter,
  ) {}

  async execute(
    id: string,
    dto: UpdateMenuItemDto,
    actor: AuthenticatedUser,
  ): Promise<MenuItemAdminDto> {
    const existing = await this.items.findById(id, true);

    if (!existing) {
      throw new ResourceNotFoundException('Menu item', id);
    }

    await this.ownership.assertRestaurant(existing.restaurantId, actor);

    if (
      dto.name &&
      (await this.items.nameExistsInCategory(existing.menuCategoryId, dto.name, id))
    ) {
      throw new ResourceConflictException(
        `This section already contains a dish named "${dto.name}".`,
      );
    }

    // Either value may be absent from the patch, so validate the combination
    // that will actually be stored rather than just what was sent.
    assertPricing(
      dto.basePrice ?? Number(existing.basePrice),
      dto.discountedPrice ??
        (existing.discountedPrice === null ? null : Number(existing.discountedPrice)),
    );

    if (dto.availableFrom !== undefined || dto.availableTo !== undefined) {
      assertAvailabilityWindow(
        dto.availableFrom ?? existing.availableFrom ?? undefined,
        dto.availableTo ?? existing.availableTo ?? undefined,
      );
    }

    // Moving a dish to another section must keep it inside the same restaurant,
    // or a vendor could graft their item onto someone else's menu.
    if (dto.menuCategoryId && dto.menuCategoryId !== existing.menuCategoryId) {
      const category = await this.menus.findCategoryById(dto.menuCategoryId);

      if (!category) {
        throw new ResourceNotFoundException('Menu category', dto.menuCategoryId);
      }

      const menu = await this.menus.findById(category.menuId);

      if (!menu || menu.restaurantId !== existing.restaurantId) {
        throw new BusinessRuleViolationException(
          'A dish can only be moved to a section of the same restaurant.',
        );
      }
    }

    const item = await this.items.update(id, dto);

    return this.presenter.present(item, true) as MenuItemAdminDto;
  }
}

@Injectable()
export class DeleteMenuItemUseCase {
  constructor(
    private readonly items: MenuItemRepository,
    private readonly ownership: MenuOwnershipGuardService,
  ) {}

  async execute(id: string, actor: AuthenticatedUser): Promise<{ message: string }> {
    const existing = await this.items.findById(id);

    if (!existing) {
      throw new ResourceNotFoundException('Menu item', id);
    }

    await this.ownership.assertRestaurant(existing.restaurantId, actor);

    // Soft delete: past order lines reference this dish and must keep
    // resolving for order history.
    await this.items.softDelete(id);

    return { message: 'Menu item removed.' };
  }
}

@Injectable()
export class MenuItemImagesUseCase {
  constructor(
    private readonly items: MenuItemRepository,
    private readonly ownership: MenuOwnershipGuardService,
  ) {}

  async list(itemId: string): Promise<MenuItemImageDto[]> {
    const item = await this.items.findById(itemId);

    if (!item) {
      throw new ResourceNotFoundException('Menu item', itemId);
    }

    return (await this.items.findImages(itemId)).map(toItemImageDto);
  }

  async add(
    itemId: string,
    dto: AddMenuItemImageDto,
    actor: AuthenticatedUser,
  ): Promise<MenuItemImageDto> {
    const item = await this.items.findById(itemId, true);

    if (!item) {
      throw new ResourceNotFoundException('Menu item', itemId);
    }

    await this.ownership.assertRestaurant(item.restaurantId, actor);

    const count = await this.items.countImages(itemId);

    if (count >= MAX_IMAGES_PER_ITEM) {
      throw new BusinessRuleViolationException(
        `A dish may have at most ${MAX_IMAGES_PER_ITEM} images.`,
      );
    }

    return toItemImageDto(
      await this.items.addImage(itemId, {
        url: dto.url,
        caption: dto.caption ?? null,
        sortOrder: count,
      }),
    );
  }

  async remove(
    itemId: string,
    imageId: string,
    actor: AuthenticatedUser,
  ): Promise<{ message: string }> {
    const item = await this.items.findById(itemId, true);

    if (!item) {
      throw new ResourceNotFoundException('Menu item', itemId);
    }

    await this.ownership.assertRestaurant(item.restaurantId, actor);

    const image = await this.items.findImageById(imageId);

    // Checking the image belongs to this dish stops a caller deleting another
    // dish's photo by pairing ids from two items.
    if (!image || image.menuItemId !== itemId) {
      throw new ResourceNotFoundException('Image', imageId);
    }

    await this.items.deleteImage(imageId);

    return { message: 'Image deleted.' };
  }
}

/** A discount above the base price would quietly raise the price instead. */
export function assertPricing(basePrice: number, discountedPrice: number | null | undefined): void {
  if (discountedPrice !== null && discountedPrice !== undefined && discountedPrice > basePrice) {
    throw new BusinessRuleViolationException('discountedPrice cannot be greater than basePrice.');
  }
}

/** Half a window is ambiguous — is the dish available before it, or after? */
export function assertAvailabilityWindow(from?: string, to?: string): void {
  if ((from === undefined) !== (to === undefined)) {
    throw new BusinessRuleViolationException(
      'availableFrom and availableTo must be provided together.',
    );
  }

  if (from !== undefined && to !== undefined && from === to) {
    throw new BusinessRuleViolationException('availableFrom and availableTo cannot be identical.');
  }
}
