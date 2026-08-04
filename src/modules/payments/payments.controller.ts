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
  PaymentDto,
  PaymentVerificationDto,
  TransactionDto,
} from './application/dto/payment-response.dto';
import {
  ListInvoicesQueryDto,
  ListPaymentsQueryDto,
  ListTransactionsQueryDto,
  StartCheckoutDto,
} from './application/dto/payment.dto';
import {
  CancelCheckoutUseCase,
  ListGatewaysUseCase,
  StartCheckoutUseCase,
} from './application/use-cases/checkout.use-cases';
import { GetInvoiceUseCase, ListInvoicesUseCase } from './application/use-cases/invoice.use-cases';
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
      'grey it out instead of failing after the customer commits to paying.',
  })
  @ApiResponse({ status: 200, type: [GatewayAvailabilityDto] })
  methods(): GatewayAvailabilityDto[] {
    return this.gateways.execute();
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
