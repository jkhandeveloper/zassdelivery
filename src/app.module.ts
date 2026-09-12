import { Module } from '@nestjs/common';
import { ConfigModule, type ConfigType } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';

import { CommonModule } from './common/common.module';
import { configurations, throttleConfig, validateEnvironment } from './config';
import { AdminModule } from './modules/admin/admin.module';
import { AuthModule } from './modules/auth/auth.module';
import { BillingModule } from './modules/billing/billing.module';
import { HealthModule } from './modules/health/health.module';
import { CartsModule } from './modules/carts/carts.module';
import { GeographyModule } from './modules/geography/geography.module';
import { MenusModule } from './modules/menus/menus.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { OrdersModule } from './modules/orders/orders.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { RealtimeModule } from './modules/realtime/realtime.module';
import { RestaurantsModule } from './modules/restaurants/restaurants.module';
import { RidersModule } from './modules/riders/riders.module';
import { SearchModule } from './modules/search/search.module';
import { StorageModule } from './modules/storage/storage.module';
import { UsersModule } from './modules/users/users.module';
import { SharedModule } from './shared/shared.module';

/**
 * The root module names what the application is made of; it deliberately holds
 * no pipeline wiring of its own. Cross-cutting request handling lives in
 * `CommonModule`, and backing infrastructure in `SharedModule`.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      load: configurations,
      // Aborts the boot on a malformed environment instead of failing later
      // with a confusing runtime error.
      validate: validateEnvironment,
      envFilePath: ['.env'],
    }),

    ThrottlerModule.forRootAsync({
      imports: [ConfigModule.forFeature(throttleConfig)],
      inject: [throttleConfig.KEY],
      useFactory: (config: ConfigType<typeof throttleConfig>) => ({
        throttlers: [{ ttl: config.ttl, limit: config.limit }],
      }),
    }),

    // How a module tells another that something happened without importing it.
    // `RidersModule` already imports `OrdersModule` for the shared state
    // machine, so dispatch reacting to an order confirmation had to travel the
    // other way round — and a forwardRef between two modules this central is
    // wiring that boots fine and fails obscurely later.
    EventEmitterModule.forRoot(),

    // Timers. Currently: the dispatch sweep that gets orders to riders and
    // expires offers nobody answered.
    ScheduleModule.forRoot(),

    // Infrastructure: database, cache, logger.
    SharedModule,

    // Global request pipeline: filters, interceptors, guards, middleware.
    CommonModule,

    // Features
    AuthModule,
    UsersModule,
    GeographyModule,
    RestaurantsModule,
    MenusModule,
    SearchModule,
    StorageModule,
    CartsModule,
    OrdersModule,
    RidersModule,
    PaymentsModule,
    BillingModule,
    NotificationsModule,
    RealtimeModule,
    AdminModule,
    HealthModule,
  ],
})
export class AppModule {}
