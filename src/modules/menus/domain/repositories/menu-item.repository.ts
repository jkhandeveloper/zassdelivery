import type {
  AddOn,
  AddOnGroup,
  DayOfWeek,
  MenuItem,
  MenuItemImage,
  MenuItemStatus,
  MenuVariant,
  Prisma,
  SpiceLevel,
} from '@prisma/client';

import type { PaginatedResult } from '@/common/interfaces/paginated-result.interface';

export type MenuItemWithRelations = MenuItem & {
  variants: MenuVariant[];
  addOnGroups: Array<AddOnGroup & { addOns: AddOn[] }>;
  images: MenuItemImage[];
  menuCategory: { id: string; name: string; menuId: string };
};

export interface ListMenuItemsFilter {
  page: number;
  limit: number;
  orderBy: Prisma.MenuItemOrderByWithRelationInput;
  restaurantId?: string;
  menuCategoryId?: string;
  status?: MenuItemStatus;
  search?: string;
  isVegetarian?: boolean;
  spiceLevel?: SpiceLevel;
  maxPrice?: number;
  minPrice?: number;
  featuredOnly?: boolean;
  /** Only items whose tracked stock is at or below their low-stock threshold. */
  lowStockOnly?: boolean;
  includeDeleted?: boolean;
}

export interface MenuItemInput {
  menuCategoryId: string;
  restaurantId: string;
  name: string;
  nameUr?: string | null;
  description?: string | null;
  imageUrl?: string | null;
  basePrice: number;
  discountedPrice?: number | null;
  status?: MenuItemStatus;
  isVegetarian?: boolean;
  spiceLevel?: SpiceLevel;
  calories?: number | null;
  preparationMinutes?: number;
  isFeatured?: boolean;
  sortOrder?: number;
  availableDays?: DayOfWeek[];
  availableFrom?: string | null;
  availableTo?: string | null;
  trackInventory?: boolean;
  stockQuantity?: number;
  lowStockThreshold?: number;
}

export interface VariantInput {
  name: string;
  price: number;
  isDefault?: boolean;
  isAvailable?: boolean;
  sortOrder?: number;
  trackInventory?: boolean;
  stockQuantity?: number;
}

export interface AddOnGroupInput {
  name: string;
  minSelect?: number;
  maxSelect?: number;
  isRequired?: boolean;
  sortOrder?: number;
}

export interface AddOnInput {
  name: string;
  price?: number;
  isAvailable?: boolean;
  sortOrder?: number;
}

/** One line of a bulk operation. */
export interface BulkItemUpdate {
  id: string;
  status?: MenuItemStatus;
  basePrice?: number;
  discountedPrice?: number | null;
  isFeatured?: boolean;
  stockQuantity?: number;
  trackInventory?: boolean;
}

/**
 * MenuItem is an aggregate root. Variants, add-on groups, add-ons and images
 * are entities inside it and are reached only through here.
 */
export abstract class MenuItemRepository {
  abstract findMany(filter: ListMenuItemsFilter): Promise<PaginatedResult<MenuItemWithRelations>>;
  abstract findById(id: string, includeDeleted?: boolean): Promise<MenuItemWithRelations | null>;
  abstract findManyByIds(ids: string[]): Promise<MenuItem[]>;
  abstract nameExistsInCategory(
    menuCategoryId: string,
    name: string,
    excludeId?: string,
  ): Promise<boolean>;
  abstract create(input: MenuItemInput): Promise<MenuItemWithRelations>;
  abstract update(id: string, input: Partial<MenuItemInput>): Promise<MenuItemWithRelations>;
  abstract softDelete(id: string): Promise<void>;

  /**
   * Applies many item updates in one transaction, so a bulk price change is
   * all-or-nothing rather than leaving the menu half-repriced.
   */
  abstract bulkUpdate(restaurantId: string, updates: BulkItemUpdate[]): Promise<number>;

  /** Adjusts stock atomically; returns null when the change would go negative. */
  abstract adjustStock(id: string, delta: number): Promise<MenuItem | null>;

  // ── Variants ──
  abstract findVariantById(id: string): Promise<MenuVariant | null>;
  abstract createVariant(menuItemId: string, input: VariantInput): Promise<MenuVariant>;
  abstract updateVariant(id: string, input: Partial<VariantInput>): Promise<MenuVariant>;
  abstract deleteVariant(id: string): Promise<void>;
  abstract countVariants(menuItemId: string): Promise<number>;
  /** Promotes one variant to default and demotes the rest, atomically. */
  abstract setDefaultVariant(menuItemId: string, variantId: string): Promise<MenuVariant>;

  // ── Add-on groups and add-ons ──
  abstract findAddOnGroupById(id: string): Promise<(AddOnGroup & { addOns: AddOn[] }) | null>;
  abstract createAddOnGroup(
    menuItemId: string,
    input: AddOnGroupInput,
  ): Promise<AddOnGroup & { addOns: AddOn[] }>;
  abstract updateAddOnGroup(id: string, input: Partial<AddOnGroupInput>): Promise<AddOnGroup>;
  abstract deleteAddOnGroup(id: string): Promise<void>;
  abstract findAddOnById(id: string): Promise<AddOn | null>;
  abstract createAddOn(groupId: string, input: AddOnInput): Promise<AddOn>;
  abstract updateAddOn(id: string, input: Partial<AddOnInput>): Promise<AddOn>;
  abstract deleteAddOn(id: string): Promise<void>;
  abstract countAddOns(groupId: string): Promise<number>;

  // ── Images ──
  abstract findImages(menuItemId: string): Promise<MenuItemImage[]>;
  abstract findImageById(id: string): Promise<MenuItemImage | null>;
  abstract addImage(
    menuItemId: string,
    input: { url: string; caption?: string | null; sortOrder: number },
  ): Promise<MenuItemImage>;
  abstract deleteImage(id: string): Promise<void>;
  abstract countImages(menuItemId: string): Promise<number>;
}
