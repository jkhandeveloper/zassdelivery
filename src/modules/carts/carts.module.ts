import { Module } from '@nestjs/common';

import { MenusModule } from '../menus/menus.module';
import { UsersModule } from '../users/users.module';
import { CartAssemblerService } from './application/use-cases/cart-assembler.service';
import {
  AddCartItemUseCase,
  ApplyCouponUseCase,
  ClearCartUseCase,
  GetCartUseCase,
  RemoveCartItemUseCase,
  RemoveCouponUseCase,
  SetCartAddressUseCase,
  SetTipUseCase,
  UpdateCartItemUseCase,
  ValidateCartUseCase,
} from './application/use-cases/cart.use-cases';
import { CartsController } from './carts.controller';
import {
  CartCouponRepository,
  CartRepository,
  DeliveryPricingRepository,
} from './domain/repositories/cart.repository';
import { CartValidationService } from './domain/services/cart-validation.service';
import { PricingService } from './domain/services/pricing.service';
import {
  PrismaCartCouponRepository,
  PrismaDeliveryPricingRepository,
} from './infrastructure/repositories/prisma-delivery-pricing.repository';
import { PrismaCartRepository } from './infrastructure/repositories/prisma-cart.repository';
import { ItemAvailabilityService } from '../menus/domain/services/item-availability.service';

@Module({
  // MenusModule supplies MenuItemRepository and ItemAvailabilityService, so the
  // cart judges availability by exactly the same rules the menu does.
  // UsersModule supplies AddressRepository for delivery-address ownership.
  imports: [MenusModule, UsersModule],
  controllers: [CartsController],
  providers: [
    // Pure domain services.
    PricingService,
    {
      provide: CartValidationService,
      useFactory: (availability: ItemAvailabilityService) =>
        new CartValidationService(availability),
      inject: [ItemAvailabilityService],
    },

    CartAssemblerService,

    GetCartUseCase,
    AddCartItemUseCase,
    UpdateCartItemUseCase,
    RemoveCartItemUseCase,
    ClearCartUseCase,
    ApplyCouponUseCase,
    RemoveCouponUseCase,
    SetCartAddressUseCase,
    SetTipUseCase,
    ValidateCartUseCase,

    { provide: CartRepository, useClass: PrismaCartRepository },
    { provide: CartCouponRepository, useClass: PrismaCartCouponRepository },
    { provide: DeliveryPricingRepository, useClass: PrismaDeliveryPricingRepository },
  ],
  // PricingService is exported so checkout prices an order with exactly the
  // same code the cart preview used.
  exports: [CartRepository, PricingService, CartValidationService],
})
export class CartsModule {}
