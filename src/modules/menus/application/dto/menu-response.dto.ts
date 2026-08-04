import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  DayOfWeek,
  MenuItemStatus,
  SpiceLevel,
  type AddOn,
  type AddOnGroup,
  type MenuCategory,
  type MenuItemImage,
  type MenuVariant,
} from '@prisma/client';

import type { MenuItemWithRelations } from '../../domain/repositories/menu-item.repository';
import type { MenuWithCategories } from '../../domain/repositories/menu.repository';
import type { ItemAvailability } from '../../domain/services/item-availability.service';

export class MenuVariantDto {
  @ApiProperty() id!: string;
  @ApiProperty({ example: 'Full' }) name!: string;
  @ApiProperty({ example: 2000 }) price!: number;
  @ApiProperty({ example: false }) isDefault!: boolean;
  @ApiProperty({ example: true, description: 'Enabled and, if tracked, in stock.' })
  isAvailable!: boolean;
  @ApiPropertyOptional({ nullable: true, example: 12 }) stockRemaining!: number | null;
  @ApiProperty({ example: 0 }) sortOrder!: number;
}

export class AddOnDto {
  @ApiProperty() id!: string;
  @ApiProperty({ example: 'Extra Cheese' }) name!: string;
  @ApiProperty({ example: 150 }) price!: number;
  @ApiProperty({ example: true }) isAvailable!: boolean;
  @ApiProperty({ example: 0 }) sortOrder!: number;
}

export class AddOnGroupDto {
  @ApiProperty() id!: string;
  @ApiProperty({ example: 'Choose a drink' }) name!: string;
  @ApiProperty({ example: 0 }) minSelect!: number;
  @ApiProperty({ example: 1 }) maxSelect!: number;
  @ApiProperty({ example: false }) isRequired!: boolean;
  @ApiProperty({ example: 0 }) sortOrder!: number;
  @ApiProperty({ type: [AddOnDto] }) addOns!: AddOnDto[];
}

export class MenuItemImageDto {
  @ApiProperty() id!: string;
  @ApiProperty() url!: string;
  @ApiPropertyOptional({ nullable: true }) caption!: string | null;
  @ApiProperty({ example: 0 }) sortOrder!: number;
}

export class MenuItemDto {
  @ApiProperty() id!: string;
  @ApiProperty({ example: 'Chapli Kabab' }) name!: string;
  @ApiPropertyOptional({ nullable: true }) nameUr!: string | null;
  @ApiPropertyOptional({ nullable: true }) description!: string | null;
  @ApiPropertyOptional({ nullable: true }) imageUrl!: string | null;

  @ApiProperty({ example: 250 }) basePrice!: number;
  @ApiPropertyOptional({ nullable: true, example: 199 }) discountedPrice!: number | null;
  @ApiProperty({
    example: 199,
    description: 'What the customer actually pays — the discount when set, otherwise basePrice.',
  })
  effectivePrice!: number;

  @ApiProperty({ enum: MenuItemStatus }) status!: MenuItemStatus;
  @ApiProperty({ example: false }) isVegetarian!: boolean;
  @ApiProperty({ enum: SpiceLevel }) spiceLevel!: SpiceLevel;
  @ApiPropertyOptional({ nullable: true, example: 450 }) calories!: number | null;
  @ApiProperty({ example: 15 }) preparationMinutes!: number;
  @ApiProperty({ example: false }) isFeatured!: boolean;
  @ApiProperty({ example: 0 }) sortOrder!: number;
  @ApiProperty({ example: 4.6 }) rating!: number;
  @ApiProperty({ example: 42 }) ratingCount!: number;

  @ApiProperty({
    example: true,
    description:
      'Orderable right now: visible, in stock, and inside its serving window. ' +
      'Clients should gate the add-to-cart button on this single flag.',
  })
  isAvailable!: boolean;

  @ApiProperty({
    enum: ['available', 'hidden', 'out_of_stock', 'outside_window', 'sold_out'],
    description: 'Why the item is unavailable, so the client can show the right message.',
  })
  availabilityReason!: string;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Units left, or null when this item does not track stock.',
  })
  stockRemaining!: number | null;

  @ApiProperty({ enum: DayOfWeek, isArray: true, description: 'Empty means every day.' })
  availableDays!: DayOfWeek[];
  @ApiPropertyOptional({ nullable: true, example: '07:00' }) availableFrom!: string | null;
  @ApiPropertyOptional({ nullable: true, example: '11:00' }) availableTo!: string | null;

  @ApiProperty({ type: [MenuVariantDto] }) variants!: MenuVariantDto[];
  @ApiProperty({ type: [AddOnGroupDto] }) addOnGroups!: AddOnGroupDto[];
  @ApiProperty({ type: [MenuItemImageDto] }) images!: MenuItemImageDto[];

  @ApiProperty() menuCategoryId!: string;
}

/** Adds the operational fields only the owner and staff see. */
export class MenuItemAdminDto extends MenuItemDto {
  @ApiProperty({ example: false }) trackInventory!: boolean;
  @ApiProperty({ example: 50 }) stockQuantity!: number;
  @ApiProperty({ example: 5 }) lowStockThreshold!: number;
  @ApiProperty({ example: false }) isLowStock!: boolean;
  @ApiPropertyOptional({ nullable: true }) deletedAt!: Date | null;
}

export class MenuCategoryDto {
  @ApiProperty() id!: string;
  @ApiProperty({ example: 'Kababs' }) name!: string;
  @ApiPropertyOptional({ nullable: true }) nameUr!: string | null;
  @ApiPropertyOptional({ nullable: true }) description!: string | null;
  @ApiPropertyOptional({ nullable: true }) imageUrl!: string | null;
  @ApiProperty({ example: 0 }) sortOrder!: number;
  @ApiProperty({ example: true }) isActive!: boolean;
  @ApiPropertyOptional({ example: 4 }) itemCount?: number;
  @ApiPropertyOptional({ type: [MenuItemDto] }) items?: MenuItemDto[];
}

export class MenuDto {
  @ApiProperty() id!: string;
  @ApiProperty({ example: 'Main Menu' }) name!: string;
  @ApiPropertyOptional({ nullable: true }) description!: string | null;
  @ApiProperty({ example: 0 }) sortOrder!: number;
  @ApiProperty({ example: true }) isActive!: boolean;
  @ApiProperty({ type: [MenuCategoryDto] }) categories!: MenuCategoryDto[];
}

export class BulkResultDto {
  @ApiProperty({ example: 12, description: 'Rows actually changed.' })
  updated!: number;

  @ApiProperty({ example: 'Updated 12 items.' })
  message!: string;
}

// ── Mappers ────────────────────────────────────────────────────

export function toVariantDto(variant: MenuVariant, isAvailable: boolean): MenuVariantDto {
  return {
    id: variant.id,
    name: variant.name,
    price: Number(variant.price),
    isDefault: variant.isDefault,
    isAvailable,
    stockRemaining: variant.trackInventory ? variant.stockQuantity : null,
    sortOrder: variant.sortOrder,
  };
}

export function toAddOnGroupDto(group: AddOnGroup & { addOns: AddOn[] }): AddOnGroupDto {
  return {
    id: group.id,
    name: group.name,
    minSelect: group.minSelect,
    maxSelect: group.maxSelect,
    isRequired: group.isRequired,
    sortOrder: group.sortOrder,
    addOns: group.addOns.map((addOn) => ({
      id: addOn.id,
      name: addOn.name,
      price: Number(addOn.price),
      isAvailable: addOn.isAvailable,
      sortOrder: addOn.sortOrder,
    })),
  };
}

export function toItemImageDto(image: MenuItemImage): MenuItemImageDto {
  return { id: image.id, url: image.url, caption: image.caption, sortOrder: image.sortOrder };
}

export interface MenuItemDtoOptions {
  availability: ItemAvailability;
  variantAvailability: (variant: MenuVariant) => boolean;
  includePrivate?: boolean;
}

/**
 * Projects a dish onto the wire shape.
 *
 * Inventory internals are opt-in: the exact stock count is an operational
 * detail, and publishing "only 2 left" to every customer is a business
 * decision the owner should make, not a side effect of the mapper.
 */
export function toMenuItemDto(
  item: MenuItemWithRelations,
  options: MenuItemDtoOptions,
): MenuItemDto | MenuItemAdminDto {
  const discounted = item.discountedPrice === null ? null : Number(item.discountedPrice);

  const dto: MenuItemDto = {
    id: item.id,
    name: item.name,
    nameUr: item.nameUr,
    description: item.description,
    imageUrl: item.imageUrl,
    basePrice: Number(item.basePrice),
    discountedPrice: discounted,
    effectivePrice: discounted ?? Number(item.basePrice),
    status: item.status,
    isVegetarian: item.isVegetarian,
    spiceLevel: item.spiceLevel,
    calories: item.calories,
    preparationMinutes: item.preparationMinutes,
    isFeatured: item.isFeatured,
    sortOrder: item.sortOrder,
    rating: Number(item.rating),
    ratingCount: item.ratingCount,
    isAvailable: options.availability.isAvailable,
    availabilityReason: options.availability.reason,
    stockRemaining: options.availability.stockRemaining,
    availableDays: item.availableDays,
    availableFrom: item.availableFrom,
    availableTo: item.availableTo,
    variants: item.variants.map((variant) =>
      toVariantDto(variant, options.variantAvailability(variant)),
    ),
    addOnGroups: item.addOnGroups.map(toAddOnGroupDto),
    images: item.images.map(toItemImageDto),
    menuCategoryId: item.menuCategoryId,
  };

  if (options.includePrivate !== true) {
    return dto;
  }

  return {
    ...dto,
    trackInventory: item.trackInventory,
    stockQuantity: item.stockQuantity,
    lowStockThreshold: item.lowStockThreshold,
    isLowStock: options.availability.isLowStock,
    deletedAt: item.deletedAt,
  };
}

export function toMenuCategoryDto(
  category: MenuCategory & { _count?: { items: number } },
): MenuCategoryDto {
  return {
    id: category.id,
    name: category.name,
    nameUr: category.nameUr,
    description: category.description,
    imageUrl: category.imageUrl,
    sortOrder: category.sortOrder,
    isActive: category.isActive,
    ...(category._count ? { itemCount: category._count.items } : {}),
  };
}

export function toMenuDto(menu: MenuWithCategories): MenuDto {
  return {
    id: menu.id,
    name: menu.name,
    description: menu.description,
    sortOrder: menu.sortOrder,
    isActive: menu.isActive,
    categories: menu.categories.map(toMenuCategoryDto),
  };
}
