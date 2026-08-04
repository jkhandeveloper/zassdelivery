import { Injectable } from '@nestjs/common';
import { MenuItemStatus } from '@prisma/client';

import {
  BusinessRuleViolationException,
  ResourceNotFoundException,
} from '@/common/exceptions/domain.exception';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';

import { MenuItemRepository } from '../../domain/repositories/menu-item.repository';
import type { BulkResultDto, MenuItemAdminDto } from '../dto/menu-response.dto';
import type { AdjustStockDto, BulkStatusDto, BulkUpdateItemsDto } from '../dto/menu.dto';
import { MenuItemPresenter, assertPricing } from './menu-items.use-cases';
import { MenuOwnershipGuardService } from './menus.use-cases';

@Injectable()
export class AdjustStockUseCase {
  constructor(
    private readonly items: MenuItemRepository,
    private readonly ownership: MenuOwnershipGuardService,
    private readonly presenter: MenuItemPresenter,
  ) {}

  async execute(
    itemId: string,
    dto: AdjustStockDto,
    actor: AuthenticatedUser,
  ): Promise<MenuItemAdminDto> {
    const item = await this.items.findById(itemId, true);

    if (!item) {
      throw new ResourceNotFoundException('Menu item', itemId);
    }

    await this.ownership.assertRestaurant(item.restaurantId, actor);

    if (!item.trackInventory) {
      throw new BusinessRuleViolationException(
        'This dish does not track inventory. Enable trackInventory before adjusting stock.',
      );
    }

    // The adjustment is a single conditional UPDATE rather than read-then-write:
    // two concurrent sales would otherwise both read the same count and oversell.
    const updated = await this.items.adjustStock(itemId, dto.delta);

    if (!updated) {
      throw new BusinessRuleViolationException(
        `Only ${item.stockQuantity} left in stock — that change would take it negative.`,
      );
    }

    const refreshed = await this.items.findById(itemId, true);

    return this.presenter.present(refreshed ?? item, true) as MenuItemAdminDto;
  }
}

@Injectable()
export class BulkUpdateItemsUseCase {
  constructor(
    private readonly items: MenuItemRepository,
    private readonly ownership: MenuOwnershipGuardService,
  ) {}

  async execute(
    restaurantId: string,
    dto: BulkUpdateItemsDto,
    actor: AuthenticatedUser,
  ): Promise<BulkResultDto> {
    await this.ownership.assertRestaurant(restaurantId, actor);

    const ids = dto.items.map((entry) => entry.id);
    const existing = await this.items.findManyByIds(ids);
    const byId = new Map(existing.map((item) => [item.id, item]));

    // Every id is checked against this restaurant before anything is written.
    // Without it a vendor could reprice a competitor's menu by guessing ids.
    const foreign = ids.filter((id) => byId.get(id)?.restaurantId !== restaurantId);

    if (foreign.length > 0) {
      throw new BusinessRuleViolationException(
        `These items do not belong to this restaurant: ${foreign.slice(0, 5).join(', ')}.`,
      );
    }

    for (const entry of dto.items) {
      const current = byId.get(entry.id);

      if (!current) {
        continue;
      }

      assertPricing(
        entry.basePrice ?? Number(current.basePrice),
        entry.discountedPrice ??
          (current.discountedPrice === null ? null : Number(current.discountedPrice)),
      );
    }

    const updated = await this.items.bulkUpdate(restaurantId, dto.items);

    return { updated, message: `Updated ${updated} item(s).` };
  }
}

@Injectable()
export class BulkStatusUseCase {
  constructor(
    private readonly items: MenuItemRepository,
    private readonly ownership: MenuOwnershipGuardService,
  ) {}

  /**
   * Flips many dishes to one status at once — the "we've run out of chicken"
   * button, which otherwise means editing twenty items by hand mid-service.
   */
  async execute(
    restaurantId: string,
    dto: BulkStatusDto,
    actor: AuthenticatedUser,
  ): Promise<BulkResultDto> {
    await this.ownership.assertRestaurant(restaurantId, actor);

    const existing = await this.items.findManyByIds(dto.itemIds);
    const byId = new Map(existing.map((item) => [item.id, item]));
    const foreign = dto.itemIds.filter((id) => byId.get(id)?.restaurantId !== restaurantId);

    if (foreign.length > 0) {
      throw new BusinessRuleViolationException(
        `These items do not belong to this restaurant: ${foreign.slice(0, 5).join(', ')}.`,
      );
    }

    const updated = await this.items.bulkUpdate(
      restaurantId,
      dto.itemIds.map((id) => ({ id, status: dto.status })),
    );

    const verb = dto.status === MenuItemStatus.AVAILABLE ? 'made available' : 'updated';

    return { updated, message: `${updated} item(s) ${verb}.` };
  }
}
