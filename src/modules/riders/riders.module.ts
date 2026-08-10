import { Module } from '@nestjs/common';

import { CartsModule } from '../carts/carts.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { OrdersModule } from '../orders/orders.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { RiderSettingsService } from './application/services/rider-settings.service';
import {
  ConfirmDeliveryUseCase,
  GetActiveDeliveryUseCase,
  PickupOrderUseCase,
  StartDeliveryUseCase,
} from './application/use-cases/delivery.use-cases';
import {
  AcceptOfferUseCase,
  AssignOrderUseCase,
  AssignmentAccessService,
  CancelAssignmentUseCase,
  ExpireOffersUseCase,
  ListAssignmentsUseCase,
  RejectOfferUseCase,
} from './application/use-cases/dispatch.use-cases';
import {
  CancelPayoutUseCase,
  EarningsSummaryUseCase,
  GetRiderWalletUseCase,
  ListEarningsUseCase,
  ListPayoutsUseCase,
  ListWalletTransactionsUseCase,
  ProcessPayoutUseCase,
  RequestPayoutUseCase,
} from './application/use-cases/earnings.use-cases';
import {
  ApproveRiderUseCase,
  GetRiderUseCase,
  ListRiderDocumentsUseCase,
  ListRidersUseCase,
  ReinstateRiderUseCase,
  RejectRiderUseCase,
  ResubmitApplicationUseCase,
  ReviewDocumentUseCase,
  SuspendRiderUseCase,
} from './application/use-cases/rider-approval.use-cases';
import {
  GetMyRiderProfileUseCase,
  ListMyDocumentsUseCase,
  RegisterRiderUseCase,
  RiderAccessService,
  SetAvailabilityUseCase,
  UpdateLocationUseCase,
  UpdateRiderProfileUseCase,
  UploadDocumentUseCase,
} from './application/use-cases/rider-profile.use-cases';
import { AssignmentRepository } from './domain/repositories/assignment.repository';
import { DeliveryNotificationPort } from './domain/repositories/delivery-notification.port';
import { RiderFinanceRepository } from './domain/repositories/rider-finance.repository';
import { RiderRepository } from './domain/repositories/rider.repository';
import { DeliveryOtpService } from './domain/services/delivery-otp.service';
import { DispatchService } from './domain/services/dispatch.service';
import { EarningsCalculator } from './domain/services/earnings.calculator';
import { PrismaAssignmentRepository } from './infrastructure/repositories/prisma-assignment.repository';
import { NotifyDeliveryNotificationAdapter } from './infrastructure/repositories/notify-delivery-notification.adapter';
import { PrismaRiderFinanceRepository } from './infrastructure/repositories/prisma-rider-finance.repository';
import { PrismaRiderRepository } from './infrastructure/repositories/prisma-rider.repository';
import { RiderManagementController } from './rider-management.controller';
import { RidersController } from './riders.controller';

@Module({
  // OrdersModule supplies AdvanceOrderUseCase, so a rider's pickup and delivery
  // drive the same state machine every other actor does; CartsModule supplies
  // the settings repository the fare and dispatch rates are read from; and
  // NotificationsModule carries the delivery code to the customer's phone.
  imports: [OrdersModule, CartsModule, NotificationsModule, RealtimeModule],
  controllers: [RidersController, RiderManagementController],
  providers: [
    // Pure domain services: no dependencies, registered directly.
    DispatchService,
    DeliveryOtpService,
    EarningsCalculator,

    RiderSettingsService,
    RiderAccessService,
    AssignmentAccessService,

    RegisterRiderUseCase,
    GetMyRiderProfileUseCase,
    UpdateRiderProfileUseCase,
    ListMyDocumentsUseCase,
    UploadDocumentUseCase,
    SetAvailabilityUseCase,
    UpdateLocationUseCase,

    ListRidersUseCase,
    GetRiderUseCase,
    ApproveRiderUseCase,
    RejectRiderUseCase,
    SuspendRiderUseCase,
    ReinstateRiderUseCase,
    ResubmitApplicationUseCase,
    ListRiderDocumentsUseCase,
    ReviewDocumentUseCase,

    AssignOrderUseCase,
    ListAssignmentsUseCase,
    AcceptOfferUseCase,
    RejectOfferUseCase,
    CancelAssignmentUseCase,
    ExpireOffersUseCase,

    PickupOrderUseCase,
    StartDeliveryUseCase,
    ConfirmDeliveryUseCase,
    GetActiveDeliveryUseCase,

    ListEarningsUseCase,
    EarningsSummaryUseCase,
    GetRiderWalletUseCase,
    ListWalletTransactionsUseCase,
    RequestPayoutUseCase,
    ListPayoutsUseCase,
    CancelPayoutUseCase,
    ProcessPayoutUseCase,

    { provide: RiderRepository, useClass: PrismaRiderRepository },
    { provide: AssignmentRepository, useClass: PrismaAssignmentRepository },
    { provide: RiderFinanceRepository, useClass: PrismaRiderFinanceRepository },
    { provide: DeliveryNotificationPort, useClass: NotifyDeliveryNotificationAdapter },
  ],
  exports: [RiderRepository, AssignmentRepository],
})
export class RidersModule {}
