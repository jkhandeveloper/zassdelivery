import { Module } from '@nestjs/common';

import { OrdersModule } from '../orders/orders.module';
import { FailPaymentAdminUseCase } from './application/use-cases/admin.use-cases';
import {
  CancelCheckoutUseCase,
  ListGatewaysUseCase,
  PaymentAccessService,
  StartCheckoutUseCase,
} from './application/use-cases/checkout.use-cases';
import {
  GetInvoiceUseCase,
  InvoiceService,
  ListInvoicesUseCase,
} from './application/use-cases/invoice.use-cases';
import { RefundPaymentUseCase } from './application/use-cases/refund.use-cases';
import { SettlementService } from './application/use-cases/settlement.service';
import {
  LedgerSummaryUseCase,
  ListTransactionsUseCase,
  OrderTransactionsUseCase,
} from './application/use-cases/transactions.use-cases';
import {
  ExpirePaymentsUseCase,
  GetPaymentUseCase,
  ListPaymentsUseCase,
  SettleCashPaymentUseCase,
  VerifyPaymentUseCase,
} from './application/use-cases/verification.use-cases';
import {
  HandleWebhookUseCase,
  ListWebhookEventsUseCase,
  ReplayWebhookUseCase,
} from './application/use-cases/webhook.use-cases';
import {
  PaymentRepository,
  WebhookEventRepository,
} from './domain/repositories/payment.repository';
import { PaymentGatewayRegistry } from './domain/services/payment-gateway';
import { EasypaisaGateway } from './infrastructure/gateways/easypaisa.gateway';
import { GatewayRegistry } from './infrastructure/gateways/gateway.registry';
import { JazzCashGateway } from './infrastructure/gateways/jazzcash.gateway';
import { PrismaPaymentRepository } from './infrastructure/repositories/prisma-payment.repository';
import { PrismaWebhookEventRepository } from './infrastructure/repositories/prisma-webhook-event.repository';
import { PaymentManagementController } from './payment-management.controller';
import { PaymentWebhooksController } from './payment-webhooks.controller';
import { PaymentsController } from './payments.controller';

@Module({
  // OrdersModule supplies OrderRepository: a payment exists to release an
  // order, and an invoice is an order seen from the money's side.
  imports: [OrdersModule],
  controllers: [PaymentsController, PaymentWebhooksController, PaymentManagementController],
  providers: [
    // Gateway adapters are concrete because the registry composes them by name;
    // everything upstream depends on PaymentGatewayRegistry instead.
    JazzCashGateway,
    EasypaisaGateway,

    InvoiceService,
    SettlementService,
    PaymentAccessService,

    ListGatewaysUseCase,
    StartCheckoutUseCase,
    CancelCheckoutUseCase,

    VerifyPaymentUseCase,
    GetPaymentUseCase,
    ListPaymentsUseCase,
    SettleCashPaymentUseCase,
    ExpirePaymentsUseCase,
    FailPaymentAdminUseCase,

    HandleWebhookUseCase,
    ReplayWebhookUseCase,
    ListWebhookEventsUseCase,

    RefundPaymentUseCase,

    GetInvoiceUseCase,
    ListInvoicesUseCase,

    ListTransactionsUseCase,
    OrderTransactionsUseCase,
    LedgerSummaryUseCase,

    { provide: PaymentGatewayRegistry, useClass: GatewayRegistry },
    { provide: PaymentRepository, useClass: PrismaPaymentRepository },
    { provide: WebhookEventRepository, useClass: PrismaWebhookEventRepository },
  ],
  exports: [PaymentRepository, InvoiceService],
})
export class PaymentsModule {}
