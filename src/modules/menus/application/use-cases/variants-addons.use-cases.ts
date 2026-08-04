import { Injectable } from '@nestjs/common';

import {
  BusinessRuleViolationException,
  ResourceConflictException,
  ResourceNotFoundException,
} from '@/common/exceptions/domain.exception';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';

import { MenuItemRepository } from '../../domain/repositories/menu-item.repository';
import { ItemAvailabilityService } from '../../domain/services/item-availability.service';
import {
  toAddOnGroupDto,
  toVariantDto,
  type AddOnDto,
  type AddOnGroupDto,
  type MenuVariantDto,
} from '../dto/menu-response.dto';
import type {
  CreateAddOnDto,
  CreateAddOnGroupDto,
  CreateVariantDto,
  UpdateAddOnDto,
  UpdateAddOnGroupDto,
  UpdateVariantDto,
} from '../dto/menu.dto';
import { MenuOwnershipGuardService } from './menus.use-cases';

const MAX_VARIANTS_PER_ITEM = 12;
const MAX_ADDONS_PER_GROUP = 30;

@Injectable()
export class VariantsUseCase {
  constructor(
    private readonly items: MenuItemRepository,
    private readonly ownership: MenuOwnershipGuardService,
    private readonly availability: ItemAvailabilityService,
  ) {}

  async create(
    itemId: string,
    dto: CreateVariantDto,
    actor: AuthenticatedUser,
  ): Promise<MenuVariantDto> {
    const item = await this.loadItem(itemId, actor);

    if ((await this.items.countVariants(itemId)) >= MAX_VARIANTS_PER_ITEM) {
      throw new BusinessRuleViolationException(
        `A dish may have at most ${MAX_VARIANTS_PER_ITEM} variants.`,
      );
    }

    if (item.variants.some((variant) => variant.name === dto.name)) {
      throw new ResourceConflictException(`This dish already has a "${dto.name}" variant.`);
    }

    // The first variant is the default; without one the storefront has nothing
    // preselected and the customer cannot add the dish to their cart.
    const isFirst = item.variants.length === 0;
    const created = await this.items.createVariant(itemId, {
      ...dto,
      isDefault: dto.isDefault ?? isFirst,
    });

    if (created.isDefault) {
      await this.items.setDefaultVariant(itemId, created.id);
    }

    return toVariantDto(created, this.availability.isVariantAvailable(created));
  }

  async update(
    itemId: string,
    variantId: string,
    dto: UpdateVariantDto,
    actor: AuthenticatedUser,
  ): Promise<MenuVariantDto> {
    await this.loadItem(itemId, actor);
    const variant = await this.items.findVariantById(variantId);

    if (!variant || variant.menuItemId !== itemId) {
      throw new ResourceNotFoundException('Variant', variantId);
    }

    const { isDefault, ...rest } = dto;
    const updated = await this.items.updateVariant(variantId, rest);

    // Promotion runs through setDefaultVariant so the "one default" rule lives
    // in a single place and demotion is atomic.
    if (isDefault === true && !variant.isDefault) {
      const promoted = await this.items.setDefaultVariant(itemId, variantId);
      return toVariantDto(promoted, this.availability.isVariantAvailable(promoted));
    }

    return toVariantDto(updated, this.availability.isVariantAvailable(updated));
  }

  async remove(
    itemId: string,
    variantId: string,
    actor: AuthenticatedUser,
  ): Promise<{ message: string }> {
    await this.loadItem(itemId, actor);
    const variant = await this.items.findVariantById(variantId);

    if (!variant || variant.menuItemId !== itemId) {
      throw new ResourceNotFoundException('Variant', variantId);
    }

    const remaining = (await this.items.countVariants(itemId)) - 1;

    // Removing the last default would leave the dish with variants but none
    // selected. Requiring another default first keeps the menu orderable.
    if (variant.isDefault && remaining > 0) {
      throw new BusinessRuleViolationException(
        'Set another variant as the default before removing this one.',
      );
    }

    await this.items.deleteVariant(variantId);

    return { message: 'Variant removed.' };
  }

  private async loadItem(itemId: string, actor: AuthenticatedUser) {
    const item = await this.items.findById(itemId, true);

    if (!item) {
      throw new ResourceNotFoundException('Menu item', itemId);
    }

    await this.ownership.assertRestaurant(item.restaurantId, actor);

    return item;
  }
}

@Injectable()
export class AddOnGroupsUseCase {
  constructor(
    private readonly items: MenuItemRepository,
    private readonly ownership: MenuOwnershipGuardService,
  ) {}

  async createGroup(
    itemId: string,
    dto: CreateAddOnGroupDto,
    actor: AuthenticatedUser,
  ): Promise<AddOnGroupDto> {
    const item = await this.loadItem(itemId, actor);

    if (item.addOnGroups.some((group) => group.name === dto.name)) {
      throw new ResourceConflictException(`This dish already has a "${dto.name}" option group.`);
    }

    assertSelectionRules(dto.minSelect, dto.maxSelect, dto.isRequired);

    return toAddOnGroupDto(await this.items.createAddOnGroup(itemId, dto));
  }

  async updateGroup(
    itemId: string,
    groupId: string,
    dto: UpdateAddOnGroupDto,
    actor: AuthenticatedUser,
  ): Promise<AddOnGroupDto> {
    await this.loadItem(itemId, actor);
    const group = await this.items.findAddOnGroupById(groupId);

    if (!group || group.menuItemId !== itemId) {
      throw new ResourceNotFoundException('Option group', groupId);
    }

    assertSelectionRules(
      dto.minSelect ?? group.minSelect,
      dto.maxSelect ?? group.maxSelect,
      dto.isRequired ?? group.isRequired,
    );

    await this.items.updateAddOnGroup(groupId, dto);
    const refreshed = await this.items.findAddOnGroupById(groupId);

    return toAddOnGroupDto(refreshed ?? group);
  }

  async removeGroup(
    itemId: string,
    groupId: string,
    actor: AuthenticatedUser,
  ): Promise<{ message: string }> {
    await this.loadItem(itemId, actor);
    const group = await this.items.findAddOnGroupById(groupId);

    if (!group || group.menuItemId !== itemId) {
      throw new ResourceNotFoundException('Option group', groupId);
    }

    await this.items.deleteAddOnGroup(groupId);

    return { message: 'Option group removed.' };
  }

  async createAddOn(
    itemId: string,
    groupId: string,
    dto: CreateAddOnDto,
    actor: AuthenticatedUser,
  ): Promise<AddOnDto> {
    await this.loadItem(itemId, actor);
    const group = await this.items.findAddOnGroupById(groupId);

    if (!group || group.menuItemId !== itemId) {
      throw new ResourceNotFoundException('Option group', groupId);
    }

    if ((await this.items.countAddOns(groupId)) >= MAX_ADDONS_PER_GROUP) {
      throw new BusinessRuleViolationException(
        `An option group may contain at most ${MAX_ADDONS_PER_GROUP} options.`,
      );
    }

    if (group.addOns.some((addOn) => addOn.name === dto.name)) {
      throw new ResourceConflictException(`This group already has an option named "${dto.name}".`);
    }

    const created = await this.items.createAddOn(groupId, dto);

    return {
      id: created.id,
      name: created.name,
      price: Number(created.price),
      isAvailable: created.isAvailable,
      sortOrder: created.sortOrder,
    };
  }

  async updateAddOn(
    itemId: string,
    addOnId: string,
    dto: UpdateAddOnDto,
    actor: AuthenticatedUser,
  ): Promise<AddOnDto> {
    await this.loadItem(itemId, actor);
    const addOn = await this.items.findAddOnById(addOnId);

    if (!addOn) {
      throw new ResourceNotFoundException('Option', addOnId);
    }

    const group = await this.items.findAddOnGroupById(addOn.groupId);

    if (!group || group.menuItemId !== itemId) {
      throw new ResourceNotFoundException('Option', addOnId);
    }

    const updated = await this.items.updateAddOn(addOnId, dto);

    return {
      id: updated.id,
      name: updated.name,
      price: Number(updated.price),
      isAvailable: updated.isAvailable,
      sortOrder: updated.sortOrder,
    };
  }

  async removeAddOn(
    itemId: string,
    addOnId: string,
    actor: AuthenticatedUser,
  ): Promise<{ message: string }> {
    await this.loadItem(itemId, actor);
    const addOn = await this.items.findAddOnById(addOnId);

    if (!addOn) {
      throw new ResourceNotFoundException('Option', addOnId);
    }

    const group = await this.items.findAddOnGroupById(addOn.groupId);

    if (!group || group.menuItemId !== itemId) {
      throw new ResourceNotFoundException('Option', addOnId);
    }

    // A required group with nothing left to choose would block checkout
    // entirely, so the last option cannot be removed while it is required.
    if (group.isRequired && group.addOns.length <= 1) {
      throw new BusinessRuleViolationException(
        'This group is required and would be left empty. Make it optional first.',
      );
    }

    await this.items.deleteAddOn(addOnId);

    return { message: 'Option removed.' };
  }

  private async loadItem(itemId: string, actor: AuthenticatedUser) {
    const item = await this.items.findById(itemId, true);

    if (!item) {
      throw new ResourceNotFoundException('Menu item', itemId);
    }

    await this.ownership.assertRestaurant(item.restaurantId, actor);

    return item;
  }
}

/** Selection rules must be satisfiable, or checkout can never be completed. */
export function assertSelectionRules(
  minSelect: number | undefined,
  maxSelect: number | undefined,
  isRequired: boolean | undefined,
): void {
  const min = minSelect ?? 0;
  const max = maxSelect ?? 1;

  if (min > max) {
    throw new BusinessRuleViolationException('minSelect cannot exceed maxSelect.');
  }

  if (isRequired === true && min < 1) {
    throw new BusinessRuleViolationException(
      'A required option group must have minSelect of at least 1.',
    );
  }
}
