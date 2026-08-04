import { Module } from '@nestjs/common';

import { CartsModule } from '../carts/carts.module';
import { RestaurantsModule } from '../restaurants/restaurants.module';
import {
  AdvanceOrderUseCase,
  CancelOrderUseCase,
  GetOrderUseCase,
  ListOrdersUseCase,
  OrderAccessService,
  OrderInvoiceUseCase,
  OrderTimelineUseCase,
  OrderTransactionsUseCase,
  RefundOrderUseCase,
} from './application/use-cases/order-lifecycle.use-cases';
import { PlaceOrderUseCase } from './application/use-cases/place-order.use-case';
import { OrderRepository } from './domain/repositories/order.repository';
import { PrismaOrderRepository } from './infrastructure/repositories/prisma-order.repository';
import { OrderManagementController } from './order-management.controller';
import { OrdersController } from './orders.controller';

@Module({
  // CartsModule supplies the cart, its assembler and the delivery/settings
  // repository — checkout prices the order with exactly the code the cart
  // preview used. RestaurantsModule resolves restaurant ownership.
  imports: [CartsModule, RestaurantsModule],
  controllers: [OrdersController, OrderManagementController],
  providers: [
    OrderAccessService,
    PlaceOrderUseCase,
    ListOrdersUseCase,
    GetOrderUseCase,
    AdvanceOrderUseCase,
    CancelOrderUseCase,
    RefundOrderUseCase,
    OrderTimelineUseCase,
    OrderTransactionsUseCase,
    OrderInvoiceUseCase,

    { provide: OrderRepository, useClass: PrismaOrderRepository },
  ],
  exports: [OrderRepository],
})
export class OrdersModule {}
