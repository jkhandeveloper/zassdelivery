import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';

import { ApiPaginatedResponse } from '@/common/decorators/api-paginated-response.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { ApiErrorResponseDto } from '@/common/dto/api-response.dto';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import type { PaginatedResult } from '@/common/interfaces/paginated-result.interface';

import {
  CheckoutDto,
  GatewayAvailabilityDto,
  InvoiceDto,
  InvoiceSummaryDto,
  OrderPaymentQrDto,
  PaymentDto,
  PaymentVerificationDto,
  TransactionDto,
} from './application/dto/payment-response.dto';
import {
  ListInvoicesQueryDto,
  ListPaymentMethodsQueryDto,
  ListPaymentsQueryDto,
  ListTransactionsQueryDto,
  MarkPaymentReceivedDto,
  StartCheckoutDto,
} from './application/dto/payment.dto';
import {
  CancelCheckoutUseCase,
  ListGatewaysUseCase,
  StartCheckoutUseCase,
} from './application/use-cases/checkout.use-cases';
import { GetInvoiceUseCase, ListInvoicesUseCase } from './application/use-cases/invoice.use-cases';
import {
  GetOrderPaymentQrUseCase,
  MarkPaymentReceivedUseCase,
} from './application/use-cases/scan-to-pay.use-cases';
import {
  ListTransactionsUseCase,
  OrderTransactionsUseCase,
} from './application/use-cases/transactions.use-cases';
import {
  GetPaymentUseCase,
  ListPaymentsUseCase,
  VerifyPaymentUseCase,
} from './application/use-cases/verification.use-cases';

/**
 * What a customer does with their own money.
 *
 * Every route is scoped to the caller: there is no id a customer could swap to
 * read another person's payments, invoices or ledger. Staff reach the same data
 * through `/payment-management`, where the scope is deliberate and permissioned.
 */
@ApiTags('Payments')
@ApiBearerAuth('access-token')
@ApiResponse({ status: 401, description: 'Not authenticated.', type: ApiErrorResponseDto })
@ApiResponse({ status: 404, description: 'Not found, or not yours.', type: ApiErrorResponseDto })
@Controller('payments')
export class PaymentsController {
  constructor(
    private readonly gateways: ListGatewaysUseCase,
    private readonly startCheckout: StartCheckoutUseCase,
    private readonly cancelCheckout: CancelCheckoutUseCase,
    private readonly orderQrCodes: GetOrderPaymentQrUseCase,
    private readonly markReceived: MarkPaymentReceivedUseCase,
    private readonly verify: VerifyPaymentUseCase,
    private readonly getPayment: GetPaymentUseCase,
    private readonly listPayments: ListPaymentsUseCase,
    private readonly getInvoice: GetInvoiceUseCase,
    private readonly listInvoices: ListInvoicesUseCase,
    private readonly listTransactions: ListTransactionsUseCase,
    private readonly orderTransactions: OrderTransactionsUseCase,
  ) {}

  // ── Paying ─────────────────────────────────────────────────

  @Get('methods')
  @ApiOperation({
    summary: 'Payment methods this deployment can take',
    description:
      'Read this rather than hard-coding a list: a gateway whose credentials ' +
      'are missing reports itself unavailable here, so the checkout screen can ' +
      'grey it out instead of failing after the customer commits to paying. ' +
      'Pass restaurantId to learn whether that restaurant takes scan-to-pay.',
  })
  @ApiResponse({ status: 200, type: [GatewayAvailabilityDto] })
  methods(@Query() query: ListPaymentMethodsQueryDto): Promise<GatewayAvailabilityDto[]> {
    return this.gateways.execute(query.restaurantId);
  }

  @Post('orders/:orderId/checkout')
  @HttpCode(HttpStatus.CREATED)
  @ApiParam({ name: 'orderId' })
  @ApiOperation({
    summary: 'Start paying for an order',
    description:
      'One entry point for every method, because the client should not have to ' +
      'know which of them redirect. The response says what to do next: ' +
      'REDIRECT (post the returned fields to the gateway), ON_DELIVERY (the ' +
      'rider collects cash) or SETTLED. An attempt that is still open is reused ' +
      'rather than stacked on — two live attempts against one order is how a ' +
      'customer ends up paying twice.',
  })
  @ApiResponse({ status: 201, type: CheckoutDto })
  @ApiResponse({
    status: 422,
    description: 'Already paid, the order cannot take a payment, or the gateway is unavailable.',
  })
  checkout(
    @Param('orderId') orderId: string,
    @Body() dto: StartCheckoutDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<CheckoutDto> {
    return this.startCheckout.execute(orderId, dto, actor);
  }

  @Get('orders/:orderId/qr-codes')
  @ApiParam({ name: 'orderId' })
  @ApiOperation({
    summary: 'The QR codes that pay for an order',
    description:
      'The restaurant’s scan-to-pay codes, and the rider’s once one has the order, ' +
      'with the amount and payment state. Poll while the payment is pending: it ' +
      'turns PAID when the payee confirms the transfer. Customer and staff only.',
  })
  @ApiResponse({ status: 200, type: OrderPaymentQrDto })
  qrCodes(
    @Param('orderId') orderId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<OrderPaymentQrDto> {
    return this.orderQrCodes.execute(orderId, actor);
  }

  @Post('orders/:orderId/mark-received')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'orderId' })
  @ApiOperation({
    summary: 'Confirm a scanned-QR payment arrived',
    description:
      'For the restaurant or the rider carrying the order, once the transfer shows ' +
      'in their JazzCash, Easypaisa or bank app — there is no gateway to confirm it ' +
      'for them. Works for scan-to-pay orders and for cash orders the customer paid ' +
      'by QR instead. The transaction ID is optional, but one ID can confirm one order only.',
  })
  @ApiResponse({ status: 200, type: PaymentDto })
  @ApiResponse({ status: 409, description: 'That transaction ID already confirmed another order.' })
  @ApiResponse({
    status: 422,
    description: 'Already paid, cancelled, or paid online through a gateway.',
  })
  markPaymentReceived(
    @Param('orderId') orderId: string,
    @Body() dto: MarkPaymentReceivedDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<PaymentDto> {
    return this.markReceived.execute(orderId, dto, actor);
  }

  @Post(':id/verify')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'id' })
  @ApiOperation({
    summary: 'Check whether a payment went through',
    description:
      'Call this the moment the customer lands back from the gateway, and on ' +
      'every refresh after. A settled payment answers from our own record; an ' +
      'unsettled one is confirmed with the provider directly, which is what ' +
      'closes the gap when a callback is lost in transit. Safe to call ' +
      'repeatedly — settling is idempotent.',
  })
  @ApiResponse({ status: 200, type: PaymentVerificationDto })
  verifyPayment(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<PaymentVerificationDto> {
    return this.verify.execute(id, actor);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'id' })
  @ApiOperation({
    summary: 'Abandon a payment attempt',
    description:
      'For a customer who backs out of the gateway to pay another way. The ' +
      'order survives — walking away from JazzCash is not cancelling dinner.',
  })
  @ApiResponse({ status: 200, type: PaymentDto })
  @ApiResponse({ status: 422, description: 'The payment has already gone through.' })
  cancel(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser): Promise<PaymentDto> {
    return this.cancelCheckout.execute(id, actor);
  }

  // ── History ────────────────────────────────────────────────

  @Get()
  @ApiOperation({
    summary: 'My payments',
    description: 'Scoped to the caller regardless of any userId in the query.',
  })
  @ApiPaginatedResponse(PaymentDto)
  mine(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: ListPaymentsQueryDto,
  ): Promise<PaginatedResult<PaymentDto>> {
    return this.listPayments.execute(query, { userId: actor.id });
  }

  @Get('transactions')
  @ApiOperation({
    summary: 'My transaction log',
    description:
      'Every movement of money involving this customer: payments, refunds and ' +
      'wallet-funded orders. Append-only — a correction is a new entry, never ' +
      'an edit to an old one.',
  })
  @ApiPaginatedResponse(TransactionDto)
  transactions(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: ListTransactionsQueryDto,
  ): Promise<PaginatedResult<TransactionDto>> {
    return this.listTransactions.execute(query, { userId: actor.id });
  }

  @Get('invoices')
  @ApiOperation({
    summary: 'My invoices',
    description: 'One summary per order — what was owed and what has been paid.',
  })
  @ApiPaginatedResponse(InvoiceSummaryDto)
  invoices(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: ListInvoicesQueryDto,
  ): Promise<PaginatedResult<InvoiceSummaryDto>> {
    return this.listInvoices.execute(query, { customerId: actor.id });
  }

  @Get('invoices/:orderId')
  @ApiParam({ name: 'orderId' })
  @ApiOperation({
    summary: 'The settlement invoice for an order',
    description:
      'Every payment attempt including the failed ones, gateway references and ' +
      'each refund — the document a finance team reconciles against a bank ' +
      'statement. `GET /orders/{id}/invoice` is the lighter customer copy of ' +
      'the same order.',
  })
  @ApiResponse({ status: 200, type: InvoiceDto })
  @ApiResponse({ status: 422, description: 'The order has not been placed yet.' })
  invoice(
    @Param('orderId') orderId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<InvoiceDto> {
    return this.getInvoice.execute(orderId, actor);
  }

  @Get('orders/:orderId/transactions')
  @ApiParam({ name: 'orderId' })
  @ApiOperation({ summary: 'Every movement of money against one order' })
  @ApiResponse({ status: 200, type: [TransactionDto] })
  forOrder(
    @Param('orderId') orderId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<TransactionDto[]> {
    return this.orderTransactions.execute(orderId, actor);
  }

  @Get(':id')
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: 'One payment attempt' })
  @ApiResponse({ status: 200, type: PaymentDto })
  detail(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser): Promise<PaymentDto> {
    return this.getPayment.execute(id, actor);
  }
}
