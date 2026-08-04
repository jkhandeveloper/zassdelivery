import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';

import { ApiPaginatedResponse } from '@/common/decorators/api-paginated-response.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { ApiErrorResponseDto } from '@/common/dto/api-response.dto';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import type { PaginatedResult } from '@/common/interfaces/paginated-result.interface';

import { MessageResponseDto } from '../auth/application/dto/auth-response.dto';
import { ListMenuItemsAdminQueryDto, ListMenusQueryDto } from './application/dto/menu-query.dto';
import {
  AddOnDto,
  AddOnGroupDto,
  BulkResultDto,
  MenuCategoryDto,
  MenuDto,
  MenuItemAdminDto,
  MenuItemImageDto,
  MenuVariantDto,
} from './application/dto/menu-response.dto';
import {
  AddMenuItemImageDto,
  AdjustStockDto,
  BulkStatusDto,
  BulkUpdateItemsDto,
  CreateAddOnDto,
  CreateAddOnGroupDto,
  CreateMenuCategoryDto,
  CreateMenuDto,
  CreateMenuItemDto,
  CreateVariantDto,
  ReorderDto,
  UpdateAddOnDto,
  UpdateAddOnGroupDto,
  UpdateMenuCategoryDto,
  UpdateMenuDto,
  UpdateMenuItemDto,
  UpdateVariantDto,
} from './application/dto/menu.dto';
import {
  AdjustStockUseCase,
  BulkStatusUseCase,
  BulkUpdateItemsUseCase,
} from './application/use-cases/inventory.use-cases';
import {
  CreateMenuItemUseCase,
  DeleteMenuItemUseCase,
  ListMenuItemsUseCase,
  MenuItemImagesUseCase,
  UpdateMenuItemUseCase,
} from './application/use-cases/menu-items.use-cases';
import {
  CreateMenuCategoryUseCase,
  CreateMenuUseCase,
  DeleteMenuCategoryUseCase,
  DeleteMenuUseCase,
  ListMenusUseCase,
  ReorderMenuCategoriesUseCase,
  UpdateMenuCategoryUseCase,
  UpdateMenuUseCase,
} from './application/use-cases/menus.use-cases';
import {
  AddOnGroupsUseCase,
  VariantsUseCase,
} from './application/use-cases/variants-addons.use-cases';

/**
 * Menu authoring for vendors and staff.
 *
 * Every write resolves the owning restaurant and re-checks management rights,
 * so a caller cannot reach another vendor's menu by supplying its ids.
 */
@ApiTags('Menu Management')
@ApiBearerAuth('access-token')
@ApiResponse({ status: 401, description: 'Not authenticated.', type: ApiErrorResponseDto })
@ApiResponse({ status: 403, description: 'Not permitted.', type: ApiErrorResponseDto })
@ApiResponse({ status: 404, description: 'Not found, or not yours.', type: ApiErrorResponseDto })
@Controller('menu-management')
export class MenuManagementController {
  constructor(
    private readonly listMenus: ListMenusUseCase,
    private readonly createMenu: CreateMenuUseCase,
    private readonly updateMenu: UpdateMenuUseCase,
    private readonly deleteMenu: DeleteMenuUseCase,
    private readonly createCategory: CreateMenuCategoryUseCase,
    private readonly updateCategory: UpdateMenuCategoryUseCase,
    private readonly deleteCategory: DeleteMenuCategoryUseCase,
    private readonly reorderCategories: ReorderMenuCategoriesUseCase,
    private readonly listItems: ListMenuItemsUseCase,
    private readonly createItem: CreateMenuItemUseCase,
    private readonly updateItem: UpdateMenuItemUseCase,
    private readonly deleteItem: DeleteMenuItemUseCase,
    private readonly itemImages: MenuItemImagesUseCase,
    private readonly variants: VariantsUseCase,
    private readonly addOns: AddOnGroupsUseCase,
    private readonly adjustStock: AdjustStockUseCase,
    private readonly bulkUpdate: BulkUpdateItemsUseCase,
    private readonly bulkStatus: BulkStatusUseCase,
  ) {}

  // ── Menus ──────────────────────────────────────────────────

  @Get('restaurants/:restaurantId/menus')
  @ApiParam({ name: 'restaurantId' })
  @ApiOperation({ summary: 'List menus, including inactive ones' })
  @ApiPaginatedResponse(MenuDto)
  menus(
    @Param('restaurantId') restaurantId: string,
    @Query() query: ListMenusQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<PaginatedResult<MenuDto>> {
    return this.listMenus.execute(restaurantId, query, actor);
  }

  @Post('restaurants/:restaurantId/menus')
  @HttpCode(HttpStatus.CREATED)
  @ApiParam({ name: 'restaurantId' })
  @ApiOperation({
    summary: 'Create a menu',
    description: 'A restaurant may run several, e.g. "Lunch" and "Late Night".',
  })
  @ApiResponse({ status: 201, type: MenuDto })
  addMenu(
    @Param('restaurantId') restaurantId: string,
    @Body() dto: CreateMenuDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<MenuDto> {
    return this.createMenu.execute(restaurantId, dto, actor);
  }

  @Patch('menus/:menuId')
  @ApiParam({ name: 'menuId' })
  @ApiOperation({ summary: 'Update a menu' })
  @ApiResponse({ status: 200, type: MenuDto })
  editMenu(
    @Param('menuId') menuId: string,
    @Body() dto: UpdateMenuDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<MenuDto> {
    return this.updateMenu.execute(menuId, dto, actor);
  }

  @Delete('menus/:menuId')
  @ApiParam({ name: 'menuId' })
  @ApiOperation({
    summary: 'Delete a menu',
    description: 'Refused while it still holds dishes — deactivate it instead.',
  })
  @ApiResponse({ status: 200, type: MessageResponseDto })
  removeMenu(
    @Param('menuId') menuId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<MessageResponseDto> {
    return this.deleteMenu.execute(menuId, actor);
  }

  // ── Menu sections ──────────────────────────────────────────

  @Post('menus/:menuId/categories')
  @HttpCode(HttpStatus.CREATED)
  @ApiParam({ name: 'menuId' })
  @ApiOperation({ summary: 'Create a menu section' })
  @ApiResponse({ status: 201, type: MenuCategoryDto })
  addCategory(
    @Param('menuId') menuId: string,
    @Body() dto: CreateMenuCategoryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<MenuCategoryDto> {
    return this.createCategory.execute(menuId, dto, actor);
  }

  @Put('menus/:menuId/categories/order')
  @ApiParam({ name: 'menuId' })
  @ApiOperation({
    summary: 'Reorder menu sections',
    description: 'Every section id must be listed, so none is left at a stale position.',
  })
  @ApiResponse({ status: 200, type: [MenuCategoryDto] })
  orderCategories(
    @Param('menuId') menuId: string,
    @Body() dto: ReorderDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<MenuCategoryDto[]> {
    return this.reorderCategories.execute(menuId, dto, actor);
  }

  @Patch('categories/:categoryId')
  @ApiParam({ name: 'categoryId' })
  @ApiOperation({ summary: 'Update a menu section' })
  @ApiResponse({ status: 200, type: MenuCategoryDto })
  editCategory(
    @Param('categoryId') categoryId: string,
    @Body() dto: UpdateMenuCategoryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<MenuCategoryDto> {
    return this.updateCategory.execute(categoryId, dto, actor);
  }

  @Delete('categories/:categoryId')
  @ApiParam({ name: 'categoryId' })
  @ApiOperation({
    summary: 'Delete a menu section',
    description: 'Refused while it still holds dishes.',
  })
  @ApiResponse({ status: 200, type: MessageResponseDto })
  removeCategory(
    @Param('categoryId') categoryId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<MessageResponseDto> {
    return this.deleteCategory.execute(categoryId, actor);
  }

  // ── Dishes ─────────────────────────────────────────────────

  @Get('restaurants/:restaurantId/items')
  @ApiParam({ name: 'restaurantId' })
  @ApiOperation({
    summary: 'List dishes with operational fields',
    description:
      'Includes hidden and soft-deleted dishes plus stock counts. Use ' +
      'lowStockOnly=true for the restock view.',
  })
  @ApiPaginatedResponse(MenuItemAdminDto)
  items(
    @Param('restaurantId') restaurantId: string,
    @Query() query: ListMenuItemsAdminQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<PaginatedResult<MenuItemAdminDto>> {
    return this.listItems.execute(restaurantId, query, actor) as Promise<
      PaginatedResult<MenuItemAdminDto>
    >;
  }

  @Post('items')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create a dish',
    description: 'The owning restaurant is derived from the section, not the request.',
  })
  @ApiResponse({ status: 201, type: MenuItemAdminDto })
  @ApiResponse({ status: 422, description: 'Discount above base price, or a half-set window.' })
  addItem(
    @Body() dto: CreateMenuItemDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<MenuItemAdminDto> {
    return this.createItem.execute(dto, actor);
  }

  @Patch('items/:itemId')
  @ApiParam({ name: 'itemId' })
  @ApiOperation({
    summary: 'Update a dish',
    description: 'A dish can only be moved to a section of the same restaurant.',
  })
  @ApiResponse({ status: 200, type: MenuItemAdminDto })
  editItem(
    @Param('itemId') itemId: string,
    @Body() dto: UpdateMenuItemDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<MenuItemAdminDto> {
    return this.updateItem.execute(itemId, dto, actor);
  }

  @Delete('items/:itemId')
  @ApiParam({ name: 'itemId' })
  @ApiOperation({
    summary: 'Remove a dish',
    description: 'Soft delete, so past order lines keep resolving.',
  })
  @ApiResponse({ status: 200, type: MessageResponseDto })
  removeItem(
    @Param('itemId') itemId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<MessageResponseDto> {
    return this.deleteItem.execute(itemId, actor);
  }

  // ── Dish images ────────────────────────────────────────────

  @Post('items/:itemId/images')
  @HttpCode(HttpStatus.CREATED)
  @ApiParam({ name: 'itemId' })
  @ApiOperation({ summary: 'Add a dish image' })
  @ApiResponse({ status: 201, type: MenuItemImageDto })
  addItemImage(
    @Param('itemId') itemId: string,
    @Body() dto: AddMenuItemImageDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<MenuItemImageDto> {
    return this.itemImages.add(itemId, dto, actor);
  }

  @Delete('items/:itemId/images/:imageId')
  @ApiParam({ name: 'itemId' })
  @ApiParam({ name: 'imageId' })
  @ApiOperation({ summary: 'Delete a dish image' })
  @ApiResponse({ status: 200, type: MessageResponseDto })
  removeItemImage(
    @Param('itemId') itemId: string,
    @Param('imageId') imageId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<MessageResponseDto> {
    return this.itemImages.remove(itemId, imageId, actor);
  }

  // ── Variants ───────────────────────────────────────────────

  @Post('items/:itemId/variants')
  @HttpCode(HttpStatus.CREATED)
  @ApiParam({ name: 'itemId' })
  @ApiOperation({
    summary: 'Add a variant',
    description: 'Price is absolute, not a delta. The first variant becomes the default.',
  })
  @ApiResponse({ status: 201, type: MenuVariantDto })
  addVariant(
    @Param('itemId') itemId: string,
    @Body() dto: CreateVariantDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<MenuVariantDto> {
    return this.variants.create(itemId, dto, actor);
  }

  @Patch('items/:itemId/variants/:variantId')
  @ApiParam({ name: 'itemId' })
  @ApiParam({ name: 'variantId' })
  @ApiOperation({ summary: 'Update a variant' })
  @ApiResponse({ status: 200, type: MenuVariantDto })
  editVariant(
    @Param('itemId') itemId: string,
    @Param('variantId') variantId: string,
    @Body() dto: UpdateVariantDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<MenuVariantDto> {
    return this.variants.update(itemId, variantId, dto, actor);
  }

  @Delete('items/:itemId/variants/:variantId')
  @ApiParam({ name: 'itemId' })
  @ApiParam({ name: 'variantId' })
  @ApiOperation({
    summary: 'Remove a variant',
    description: 'Set another default first if this one is it.',
  })
  @ApiResponse({ status: 200, type: MessageResponseDto })
  removeVariant(
    @Param('itemId') itemId: string,
    @Param('variantId') variantId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<MessageResponseDto> {
    return this.variants.remove(itemId, variantId, actor);
  }

  // ── Extra options ──────────────────────────────────────────

  @Post('items/:itemId/option-groups')
  @HttpCode(HttpStatus.CREATED)
  @ApiParam({ name: 'itemId' })
  @ApiOperation({
    summary: 'Add an option group',
    description: 'Selection rules must be satisfiable, e.g. minSelect ≤ maxSelect.',
  })
  @ApiResponse({ status: 201, type: AddOnGroupDto })
  addGroup(
    @Param('itemId') itemId: string,
    @Body() dto: CreateAddOnGroupDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<AddOnGroupDto> {
    return this.addOns.createGroup(itemId, dto, actor);
  }

  @Patch('items/:itemId/option-groups/:groupId')
  @ApiParam({ name: 'itemId' })
  @ApiParam({ name: 'groupId' })
  @ApiOperation({ summary: 'Update an option group' })
  @ApiResponse({ status: 200, type: AddOnGroupDto })
  editGroup(
    @Param('itemId') itemId: string,
    @Param('groupId') groupId: string,
    @Body() dto: UpdateAddOnGroupDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<AddOnGroupDto> {
    return this.addOns.updateGroup(itemId, groupId, dto, actor);
  }

  @Delete('items/:itemId/option-groups/:groupId')
  @ApiParam({ name: 'itemId' })
  @ApiParam({ name: 'groupId' })
  @ApiOperation({ summary: 'Remove an option group' })
  @ApiResponse({ status: 200, type: MessageResponseDto })
  removeGroup(
    @Param('itemId') itemId: string,
    @Param('groupId') groupId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<MessageResponseDto> {
    return this.addOns.removeGroup(itemId, groupId, actor);
  }

  @Post('items/:itemId/option-groups/:groupId/options')
  @HttpCode(HttpStatus.CREATED)
  @ApiParam({ name: 'itemId' })
  @ApiParam({ name: 'groupId' })
  @ApiOperation({ summary: 'Add an option' })
  @ApiResponse({ status: 201, type: AddOnDto })
  addOption(
    @Param('itemId') itemId: string,
    @Param('groupId') groupId: string,
    @Body() dto: CreateAddOnDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<AddOnDto> {
    return this.addOns.createAddOn(itemId, groupId, dto, actor);
  }

  @Patch('items/:itemId/options/:optionId')
  @ApiParam({ name: 'itemId' })
  @ApiParam({ name: 'optionId' })
  @ApiOperation({ summary: 'Update an option' })
  @ApiResponse({ status: 200, type: AddOnDto })
  editOption(
    @Param('itemId') itemId: string,
    @Param('optionId') optionId: string,
    @Body() dto: UpdateAddOnDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<AddOnDto> {
    return this.addOns.updateAddOn(itemId, optionId, dto, actor);
  }

  @Delete('items/:itemId/options/:optionId')
  @ApiParam({ name: 'itemId' })
  @ApiParam({ name: 'optionId' })
  @ApiOperation({
    summary: 'Remove an option',
    description: 'A required group cannot be left with nothing to choose.',
  })
  @ApiResponse({ status: 200, type: MessageResponseDto })
  removeOption(
    @Param('itemId') itemId: string,
    @Param('optionId') optionId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<MessageResponseDto> {
    return this.addOns.removeAddOn(itemId, optionId, actor);
  }

  // ── Inventory and bulk operations ──────────────────────────

  @Post('items/:itemId/stock')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'itemId' })
  @ApiOperation({
    summary: 'Adjust stock',
    description:
      'Signed delta applied atomically in a single conditional UPDATE, so two ' +
      'concurrent sales cannot oversell the kitchen.',
  })
  @ApiResponse({ status: 200, type: MenuItemAdminDto })
  @ApiResponse({ status: 422, description: 'Not tracked, or the change would go negative.' })
  stock(
    @Param('itemId') itemId: string,
    @Body() dto: AdjustStockDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<MenuItemAdminDto> {
    return this.adjustStock.execute(itemId, dto, actor);
  }

  @Patch('restaurants/:restaurantId/items/bulk')
  @ApiParam({ name: 'restaurantId' })
  @ApiOperation({
    summary: 'Bulk update dishes',
    description:
      'Reprice or restock up to 200 dishes in one transaction. Every id is ' +
      'verified against this restaurant before anything is written.',
  })
  @ApiResponse({ status: 200, type: BulkResultDto })
  bulk(
    @Param('restaurantId') restaurantId: string,
    @Body() dto: BulkUpdateItemsDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<BulkResultDto> {
    return this.bulkUpdate.execute(restaurantId, dto, actor);
  }

  @Patch('restaurants/:restaurantId/items/bulk-status')
  @ApiParam({ name: 'restaurantId' })
  @ApiOperation({
    summary: 'Bulk change availability',
    description: 'The "we\'ve run out of chicken" button — one call, many dishes.',
  })
  @ApiResponse({ status: 200, type: BulkResultDto })
  bulkAvailability(
    @Param('restaurantId') restaurantId: string,
    @Body() dto: BulkStatusDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<BulkResultDto> {
    return this.bulkStatus.execute(restaurantId, dto, actor);
  }
}
