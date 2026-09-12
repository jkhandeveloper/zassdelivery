import { Module } from '@nestjs/common';

import { AdminModule } from '../admin/admin.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { RestaurantsModule } from '../restaurants/restaurants.module';
import { RestaurantApprovedListener } from './application/listeners/restaurant-approved.listener';
import { BillingPricingService } from './application/services/billing-pricing.service';
import { BillingSweepService } from './application/services/billing-sweep.service';
import {
  ConfirmTransferUseCase,
  ListBillingInvoicesUseCase,
  ListSubscriptionsUseCase,
  RecordPaymentUseCase,
  ReinstateVendorUseCase,
  RejectTransferUseCase,
  SetMonthlyFeeUseCase,
  SuspendVendorUseCase,
  UpdatePaymentRecordUseCase,
  VoidInvoiceUseCase,
} from './application/use-cases/billing-admin.use-cases';
import {
  GetDefaultFeeUseCase,
  SetDefaultFeeUseCase,
} from './application/use-cases/platform-fee.use-cases';
import {
  GetPlatformQrCodesUseCase,
  SetPlatformQrCodesUseCase,
} from './application/use-cases/platform-qr.use-cases';
import {
  GetVendorBillingUseCase,
  ListVendorInvoicesUseCase,
  SubmitVendorTransferUseCase,
  VendorBillingAccessService,
} from './application/use-cases/vendor-billing.use-cases';
import { BillingManagementController } from './billing-management.controller';
import { BillingRepository } from './domain/repositories/billing.repository';
import { PrismaBillingRepository } from './infrastructure/repositories/prisma-billing.repository';
import { VendorBillingController } from './vendor-billing.controller';

@Module({
  // RestaurantsModule supplies RestaurantRepository, for checking that the
  // caller owns the listing whose money they are asking about. AdminModule
  // supplies SettingRepository, which holds the platform's monthly rate and its
  // own QR codes. NotificationsModule is how a vendor learns any of this
  // happened — it is the only route to a user, so preferences stay meaningful.
  //
  // Nothing imports billing back. Approval reaches it through an event instead,
  // which is what keeps restaurants and billing from becoming a cycle.
  imports: [RestaurantsModule, AdminModule, NotificationsModule],
  controllers: [VendorBillingController, BillingManagementController],
  providers: [
    BillingPricingService,

    // The nightly pass: issues invoices, warns, and closes listings that never
    // paid. Registered here because this module owns the tables it writes to.
    BillingSweepService,
    RestaurantApprovedListener,

    VendorBillingAccessService,
    GetVendorBillingUseCase,
    ListVendorInvoicesUseCase,
    SubmitVendorTransferUseCase,

    ListSubscriptionsUseCase,
    ListBillingInvoicesUseCase,
    ConfirmTransferUseCase,
    RejectTransferUseCase,
    VoidInvoiceUseCase,
    SetMonthlyFeeUseCase,
    SuspendVendorUseCase,
    ReinstateVendorUseCase,

    GetPlatformQrCodesUseCase,
    SetPlatformQrCodesUseCase,

    RecordPaymentUseCase,
    UpdatePaymentRecordUseCase,
    GetDefaultFeeUseCase,
    SetDefaultFeeUseCase,

    { provide: BillingRepository, useClass: PrismaBillingRepository },
  ],
  exports: [BillingRepository],
})
export class BillingModule {}
