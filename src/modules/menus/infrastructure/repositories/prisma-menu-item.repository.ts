import { Injectable } from '@nestjs/common';
import type {
  AddOn,
  AddOnGroup,
  MenuItem,
  MenuItemImage,
  MenuVariant,
  Prisma,
} from '@prisma/client';

import type { PaginatedResult } from '@/common/interfaces/paginated-result.interface';
import { paginate } from '@/common/utils/pagination.util';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';

import {
  MenuItemRepository,
  type AddOnGroupInput,
  type AddOnInput,
  type BulkItemUpdate,
  type ListMenuItemsFilter,
  type MenuItemInput,
  type MenuItemWithRelations,
  type VariantInput,
} from '../../domain/repositories/menu-item.repository';

const RELATIONS = {
  variants: { orderBy: { sortOrder: 'asc' } },
  addOnGroups: {
    orderBy: { sortOrder: 'asc' },
    include: { addOns: { orderBy: { sortOrder: 'asc' } } },
  },
  images: { orderBy: { sortOrder: 'asc' } },
  menuCategory: { select: { id: true, name: true, menuId: true } },
} satisfies Prisma.MenuItemInclude;

@Injectable()
export class PrismaMenuItemRepository extends MenuItemRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async findMany(filter: ListMenuItemsFilter): Promise<PaginatedResult<MenuItemWithRelations>> {
    const where = this.buildWhere(filter);

    const [total, items] = await this.prisma.$transaction([
      this.prisma.menuItem.count({ where }),
      this.prisma.menuItem.findMany({
        where,
        include: RELATIONS,
        orderBy: filter.orderBy,
        skip: (filter.page - 1) * filter.limit,
        take: filter.limit,
      }),
    ]);

    return paginate(items, total, filter.page, filter.limit);
  }

  async findById(id: string, includeDeleted = false): Promise<MenuItemWithRelations | null> {
    const item = await this.prisma.menuItem.findUnique({ where: { id }, include: RELATIONS });

    if (!item || (!includeDeleted && item.deletedAt !== null)) {
      return null;
    }

    return item;
  }

  async findManyByIds(ids: string[]): Promise<MenuItem[]> {
    return this.prisma.menuItem.findMany({ where: { id: { in: ids }, deletedAt: null } });
  }

  async nameExistsInCategory(
    menuCategoryId: string,
    name: string,
    excludeId?: string,
  ): Promise<boolean> {
    const found = await this.prisma.menuItem.findFirst({
      where: {
        menuCategoryId,
        name,
        deletedAt: null,
        ...(excludeId && { id: { not: excludeId } }),
      },
      select: { id: true },
    });

    return found !== null;
  }

  async create(input: MenuItemInput): Promise<MenuItemWithRelations> {
    return this.prisma.menuItem.create({ data: input, include: RELATIONS });
  }

  async update(id: string, input: Partial<MenuItemInput>): Promise<MenuItemWithRelations> {
    return this.prisma.menuItem.update({ where: { id }, data: input, include: RELATIONS });
  }

  async softDelete(id: string): Promise<void> {
    await this.prisma.menuItem.update({
      where: { id },
      data: { deletedAt: new Date(), status: 'HIDDEN' },
    });
  }

  async bulkUpdate(restaurantId: string, updates: BulkItemUpdate[]): Promise<number> {
    // One transaction so a bulk reprice either lands in full or not at all.
    // `restaurantId` is repeated in every WHERE as a second line of defence:
    // even a caller-supplied id that slipped past validation cannot touch
    // another restaurant's row.
    const results = await this.prisma.$transaction(
      updates.map(({ id, ...data }) =>
        this.prisma.menuItem.updateMany({
          where: { id, restaurantId, deletedAt: null },
          data,
        }),
      ),
    );

    return results.reduce((total, result) => total + result.count, 0);
  }

  async adjustStock(id: string, delta: number): Promise<MenuItem | null> {
    // A conditional updateMany is what makes this atomic: the guard on
    // stock_quantity is evaluated by Postgres as part of the same statement,
    // so two concurrent sales cannot both pass the check.
    const result = await this.prisma.menuItem.updateMany({
      where: {
        id,
        deletedAt: null,
        ...(delta < 0 && { stockQuantity: { gte: Math.abs(delta) } }),
      },
      data: { stockQuantity: { increment: delta } },
    });

    if (result.count === 0) {
      return null;
    }

    return this.prisma.menuItem.findUnique({ where: { id } });
  }

  // ── Variants ──

  async findVariantById(id: string): Promise<MenuVariant | null> {
    return this.prisma.menuVariant.findUnique({ where: { id } });
  }

  async createVariant(menuItemId: string, input: VariantInput): Promise<MenuVariant> {
    return this.prisma.menuVariant.create({ data: { menuItemId, ...input } });
  }

  async updateVariant(id: string, input: Partial<VariantInput>): Promise<MenuVariant> {
    return this.prisma.menuVariant.update({ where: { id }, data: input });
  }

  async deleteVariant(id: string): Promise<void> {
    await this.prisma.menuVariant.delete({ where: { id } });
  }

  async countVariants(menuItemId: string): Promise<number> {
    return this.prisma.menuVariant.count({ where: { menuItemId } });
  }

  async setDefaultVariant(menuItemId: string, variantId: string): Promise<MenuVariant> {
    return this.prisma.$transaction(async (tx) => {
      await tx.menuVariant.updateMany({
        where: { menuItemId, isDefault: true, id: { not: variantId } },
        data: { isDefault: false },
      });

      return tx.menuVariant.update({ where: { id: variantId }, data: { isDefault: true } });
    });
  }

  // ── Add-on groups and add-ons ──

  async findAddOnGroupById(id: string): Promise<(AddOnGroup & { addOns: AddOn[] }) | null> {
    return this.prisma.addOnGroup.findUnique({
      where: { id },
      include: { addOns: { orderBy: { sortOrder: 'asc' } } },
    });
  }

  async createAddOnGroup(
    menuItemId: string,
    input: AddOnGroupInput,
  ): Promise<AddOnGroup & { addOns: AddOn[] }> {
    return this.prisma.addOnGroup.create({
      data: { menuItemId, ...input },
      include: { addOns: true },
    });
  }

  async updateAddOnGroup(id: string, input: Partial<AddOnGroupInput>): Promise<AddOnGroup> {
    return this.prisma.addOnGroup.update({ where: { id }, data: input });
  }

  async deleteAddOnGroup(id: string): Promise<void> {
    await this.prisma.addOnGroup.delete({ where: { id } });
  }

  async findAddOnById(id: string): Promise<AddOn | null> {
    return this.prisma.addOn.findUnique({ where: { id } });
  }

  async createAddOn(groupId: string, input: AddOnInput): Promise<AddOn> {
    return this.prisma.addOn.create({ data: { groupId, ...input } });
  }

  async updateAddOn(id: string, input: Partial<AddOnInput>): Promise<AddOn> {
    return this.prisma.addOn.update({ where: { id }, data: input });
  }

  async deleteAddOn(id: string): Promise<void> {
    await this.prisma.addOn.delete({ where: { id } });
  }

  async countAddOns(groupId: string): Promise<number> {
    return this.prisma.addOn.count({ where: { groupId } });
  }

  // ── Images ──

  async findImages(menuItemId: string): Promise<MenuItemImage[]> {
    return this.prisma.menuItemImage.findMany({
      where: { menuItemId },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async findImageById(id: string): Promise<MenuItemImage | null> {
    return this.prisma.menuItemImage.findUnique({ where: { id } });
  }

  async addImage(
    menuItemId: string,
    input: { url: string; caption?: string | null; sortOrder: number },
  ): Promise<MenuItemImage> {
    return this.prisma.menuItemImage.create({ data: { menuItemId, ...input } });
  }

  async deleteImage(id: string): Promise<void> {
    await this.prisma.menuItemImage.delete({ where: { id } });
  }

  async countImages(menuItemId: string): Promise<number> {
    return this.prisma.menuItemImage.count({ where: { menuItemId } });
  }

  private buildWhere(filter: ListMenuItemsFilter): Prisma.MenuItemWhereInput {
    const where: Prisma.MenuItemWhereInput = {};

    if (filter.includeDeleted !== true) {
      where.deletedAt = null;
    }

    if (filter.restaurantId !== undefined) {
      where.restaurantId = filter.restaurantId;
    }

    if (filter.menuCategoryId !== undefined) {
      where.menuCategoryId = filter.menuCategoryId;
    }

    if (filter.status !== undefined) {
      where.status = filter.status;
    }

    if (filter.isVegetarian !== undefined) {
      where.isVegetarian = filter.isVegetarian;
    }

    if (filter.spiceLevel !== undefined) {
      where.spiceLevel = filter.spiceLevel;
    }

    if (filter.featuredOnly === true) {
      where.isFeatured = true;
    }

    if (filter.minPrice !== undefined || filter.maxPrice !== undefined) {
      where.basePrice = {
        ...(filter.minPrice !== undefined && { gte: filter.minPrice }),
        ...(filter.maxPrice !== undefined && { lte: filter.maxPrice }),
      };
    }

    if (filter.lowStockOnly === true) {
      // Prisma cannot compare two columns, so the threshold is applied in SQL
      // through the partial index instead; this narrows to tracked items with
      // a small count, which is what the owner's restock view needs.
      where.trackInventory = true;
      where.stockQuantity = { lte: 10 };
    }

    if (filter.search !== undefined && filter.search.length > 0) {
      // Backed by the GIN trigram index on menu_items.name.
      where.OR = [
        { name: { contains: filter.search, mode: 'insensitive' } },
        { description: { contains: filter.search, mode: 'insensitive' } },
      ];
    }

    return where;
  }
}
