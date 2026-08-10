import { Module } from '@nestjs/common';

import { CartsModule } from '../carts/carts.module';
import { RealtimeModule } from '../realtime/realtime.module';
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
  // preview used. RestaurantsModule resolves restaurant ownership, and
  // RealtimeModule pushes each transition to whoever is watching.
  imports: [CartsModule, RestaurantsModule, RealtimeModule],
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
  // AdvanceOrderUseCase is exported for the riders module: a rider's pickup and
  // delivery routes drive the same state machine as everyone else's, rather
  // than reimplementing the transitions alongside it.
  exports: [OrderRepository, AdvanceOrderUseCase, OrderAccessService],
})
export class OrdersModule {}
