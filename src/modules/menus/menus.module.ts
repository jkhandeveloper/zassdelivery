import { Module } from '@nestjs/common';

import { RestaurantsModule } from '../restaurants/restaurants.module';
import {
  AdjustStockUseCase,
  BulkStatusUseCase,
  BulkUpdateItemsUseCase,
} from './application/use-cases/inventory.use-cases';
import {
  CreateMenuItemUseCase,
  DeleteMenuItemUseCase,
  GetMenuItemUseCase,
  ListMenuItemsUseCase,
  MenuItemImagesUseCase,
  MenuItemPresenter,
  UpdateMenuItemUseCase,
} from './application/use-cases/menu-items.use-cases';
import {
  CreateMenuCategoryUseCase,
  CreateMenuUseCase,
  DeleteMenuCategoryUseCase,
  DeleteMenuUseCase,
  GetPublicMenuUseCase,
  ListMenusUseCase,
  MenuOwnershipGuardService,
  ReorderMenuCategoriesUseCase,
  UpdateMenuCategoryUseCase,
  UpdateMenuUseCase,
} from './application/use-cases/menus.use-cases';
import {
  AddOnGroupsUseCase,
  VariantsUseCase,
} from './application/use-cases/variants-addons.use-cases';
import { MenuItemRepository } from './domain/repositories/menu-item.repository';
import { MenuRepository } from './domain/repositories/menu.repository';
import { ItemAvailabilityService } from './domain/services/item-availability.service';
import { PrismaMenuItemRepository } from './infrastructure/repositories/prisma-menu-item.repository';
import { PrismaMenuRepository } from './infrastructure/repositories/prisma-menu.repository';
import { MenuManagementController } from './menu-management.controller';
import { MenusController } from './menus.controller';

@Module({
  // RestaurantsModule supplies RestaurantRepository, which every ownership
  // check in this module resolves against.
  imports: [RestaurantsModule],
  controllers: [MenusController, MenuManagementController],
  providers: [
    // Pure domain service: no dependencies.
    ItemAvailabilityService,

    MenuOwnershipGuardService,
    MenuItemPresenter,

    ListMenusUseCase,
    CreateMenuUseCase,
    UpdateMenuUseCase,
    DeleteMenuUseCase,
    GetPublicMenuUseCase,

    CreateMenuCategoryUseCase,
    UpdateMenuCategoryUseCase,
    DeleteMenuCategoryUseCase,
    ReorderMenuCategoriesUseCase,

    ListMenuItemsUseCase,
    GetMenuItemUseCase,
    CreateMenuItemUseCase,
    UpdateMenuItemUseCase,
    DeleteMenuItemUseCase,
    MenuItemImagesUseCase,

    VariantsUseCase,
    AddOnGroupsUseCase,

    AdjustStockUseCase,
    BulkUpdateItemsUseCase,
    BulkStatusUseCase,

    { provide: MenuRepository, useClass: PrismaMenuRepository },
    { provide: MenuItemRepository, useClass: PrismaMenuItemRepository },
  ],
  exports: [MenuRepository, MenuItemRepository, ItemAvailabilityService],
})
export class MenusModule {}
