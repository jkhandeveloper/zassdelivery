import { Module } from '@nestjs/common';

import { UsersModule } from '../users/users.module';
import {
  CreateCategoryUseCase,
  DeleteCategoryUseCase,
  ListCategoriesUseCase,
  UpdateCategoryUseCase,
} from './application/use-cases/categories.use-cases';
import {
  ApproveRestaurantUseCase,
  ChangeRestaurantStatusUseCase,
  RejectRestaurantUseCase,
  ResubmitRestaurantUseCase,
  SetAcceptingOrdersUseCase,
} from './application/use-cases/approval.use-cases';
import {
  AddRestaurantImageUseCase,
  DeleteRestaurantImageUseCase,
  GetBusinessHoursUseCase,
  ListRestaurantImagesUseCase,
  ReorderRestaurantImagesUseCase,
  SetBusinessHoursUseCase,
} from './application/use-cases/hours-images.use-cases';
import {
  DeleteRestaurantUseCase,
  GetRestaurantUseCase,
  ListRestaurantsAdminUseCase,
  RegisterRestaurantUseCase,
  SearchRestaurantsUseCase,
  UpdateRestaurantUseCase,
} from './application/use-cases/restaurants.use-cases';
import { RestaurantCategoryRepository } from './domain/repositories/restaurant-category.repository';
import { RestaurantRepository } from './domain/repositories/restaurant.repository';
import { OpeningHoursService } from './domain/services/opening-hours.service';
import { PrismaRestaurantCategoryRepository } from './infrastructure/repositories/prisma-restaurant-category.repository';
import { PrismaRestaurantRepository } from './infrastructure/repositories/prisma-restaurant.repository';
import { RestaurantCategoriesController } from './restaurant-categories.controller';
import { RestaurantManagementController } from './restaurant-management.controller';
import { RestaurantsController } from './restaurants.controller';

@Module({
  // UsersModule supplies AddressRepository, whose resolveZone() decides which
  // delivery zone a restaurant's coordinates fall into.
  imports: [UsersModule],
  controllers: [
    RestaurantsController,
    RestaurantManagementController,
    RestaurantCategoriesController,
  ],
  providers: [
    // Pure domain service: no dependencies, so it is registered directly.
    OpeningHoursService,

    SearchRestaurantsUseCase,
    GetRestaurantUseCase,
    ListRestaurantsAdminUseCase,
    RegisterRestaurantUseCase,
    UpdateRestaurantUseCase,
    DeleteRestaurantUseCase,

    ApproveRestaurantUseCase,
    RejectRestaurantUseCase,
    ResubmitRestaurantUseCase,
    ChangeRestaurantStatusUseCase,
    SetAcceptingOrdersUseCase,

    GetBusinessHoursUseCase,
    SetBusinessHoursUseCase,
    ListRestaurantImagesUseCase,
    AddRestaurantImageUseCase,
    DeleteRestaurantImageUseCase,
    ReorderRestaurantImagesUseCase,

    ListCategoriesUseCase,
    CreateCategoryUseCase,
    UpdateCategoryUseCase,
    DeleteCategoryUseCase,

    { provide: RestaurantRepository, useClass: PrismaRestaurantRepository },
    { provide: RestaurantCategoryRepository, useClass: PrismaRestaurantCategoryRepository },
  ],
  exports: [RestaurantRepository, RestaurantCategoryRepository, OpeningHoursService],
})
export class RestaurantsModule {}
