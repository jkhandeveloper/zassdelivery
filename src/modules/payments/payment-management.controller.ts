import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { PaymentMethod, PaymentStatus } from '@prisma/client';

import { ApiPaginatedResponse } from '@/common/decorators/api-paginated-response.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { RequirePermissions } from '@/common/decorators/permissions.decorator';
import { ApiErrorResponseDto } from '@/common/dto/api-response.dto';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import type { PaginatedResult } from '@/common/interfaces/paginated-result.interface';

import {
  InvoiceDto,
  InvoiceSummaryDto,
  LedgerSummaryDto,
  PaymentDto,
  TransactionDto,
  WebhookEventDto,
} from './application/dto/payment-response.dto';
import {
  FailPaymentDto,
  LedgerSummaryQueryDto,
  ListInvoicesQueryDto,
  ListPaymentsQueryDto,
  ListTransactionsQueryDto,
  ListWebhookEventsQueryDto,
  RefundPaymentDto,
} from './application/dto/payment.dto';
import { GetInvoiceUseCase, ListInvoicesUseCase } from './application/use-cases/invoice.use-cases';
import { RefundPaymentUseCase, type RefundOutcome } from './application/use-cases/refund.use-cases';
import {
  LedgerSummaryUseCase,
  ListTransactionsUseCase,
} from './application/use-cases/transactions.use-cases';
import {
  ExpirePaymentsUseCase,
  ListPaymentsUseCase,
  SettleCashPaymentUseCase,
} from './application/use-cases/verification.use-cases';
import {
  ListWebhookEventsUseCase,
  ReplayWebhookUseCase,
} from './application/use-cases/webhook.use-cases';
import { FailPaymentAdminUseCase } from './application/use-cases/admin.use-cases';

/**
 * The finance and support view of money.
 *
 * Permission-guarded rather than role-guarded, and split deliberately:
 * `payments.read` is enough to investigate a customer's complaint, while
 * `payments.refund` is what it takes to actually move money back. A support
 * agent needs the first far more often than the second.
 */
@ApiTags('Payment Management')
@ApiBearerAuth('access-token')
@ApiResponse({ status: 401, description: 'Not authenticated.', type: ApiErrorResponseDto })
@ApiResponse({ status: 403, description: 'Not permitted.', type: ApiErrorResponseDto })
@ApiResponse({ status: 404, description: 'Not found.', type: ApiErrorResponseDto })
@Controller('payment-management')
export class PaymentManagementController {
  constructor(
    private readonly listPayments: ListPaymentsUseCase,
    private readonly refund: RefundPaymentUseCase,
    private readonly settleCash: SettleCashPaymentUseCase,
    private readonly failPayment: FailPaymentAdminUseCase,
    private readonly expire: ExpirePaymentsUseCase,
    private readonly listTransactions: ListTransactionsUseCase,
    private readonly ledger: LedgerSummaryUseCase,
    private readonly listWebhooks: ListWebhookEventsUseCase,
    private readonly replayWebhook: ReplayWebhookUseCase,
    private readonly listInvoices: ListInvoicesUseCase,
    private readonly getInvoice: GetInvoiceUseCase,
  ) {}

  // ── Payments ───────────────────────────────────────────────

  @Get('payments')
  @RequirePermissions('payments.read')
  @ApiOperation({
    summary: 'All payments',
    description:
      'Across every customer and method. Search matches our reference, the ' +
      'gateway transaction id or the order number — the three things a customer ' +
      'or a bank statement might quote.',
  })
  @ApiPaginatedResponse(PaymentDto)
  payments(@Query() query: ListPaymentsQueryDto): Promise<PaginatedResult<PaymentDto>> {
    return this.listPayments.execute(query);
  }

  @Get('payments/outstanding-cash')
  @RequirePermissions('payments.read')
  @ApiOperation({
    summary: 'Cash not yet collected',
    description:
      'Cash orders still owing. Normally these clear themselves when the rider ' +
      'confirms delivery; anything lingering here is a reconciliation question.',
  })
  @ApiPaginatedResponse(PaymentDto)
  outstandingCash(@Query() query: ListPaymentsQueryDto): Promise<PaginatedResult<PaymentDto>> {
    return this.listPayments.execute(query, {
      method: PaymentMethod.CASH_ON_DELIVERY,
      status: PaymentStatus.PENDING,
    });
  }

  @Post('payments/:id/refund')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('payments.refund')
  @ApiParam({ name: 'id' })
  @ApiOperation({
    summary: 'Refund a payment',
    description:
      'Additive rather than a reversal: the original payment is never ' +
      'rewritten and the correction lives in the ledger. Partial refunds ' +
      'accumulate and can never exceed what was taken. `destination=SOURCE` ' +
      'returns the money the way it arrived and falls back to the wallet if the ' +
      'gateway refuses — the response always says which way it actually went.',
  })
  @ApiResponse({ status: 200, description: 'Refund issued.' })
  @ApiResponse({
    status: 422,
    description: 'Never collected, already fully refunded, or the amount is too large.',
  })
  issueRefund(
    @Param('id') id: string,
    @Body() dto: RefundPaymentDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<RefundOutcome> {
    return this.refund.execute(id, dto, actor);
  }

  @Post('payments/:id/mark-collected')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('payments.refund')
  @ApiParam({ name: 'id' })
  @ApiOperation({
    summary: 'Record cash as collected',
    description:
      'For the cases the rider flow does not cover — settled at the counter, ' +
      'or an app that failed at the door. Deliberately restricted: it turns ' +
      '"no money" into "money" on somebody’s word.',
  })
  @ApiResponse({ status: 200, type: PaymentDto })
  markCollected(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<PaymentDto> {
    return this.settleCash.execute(id, actor);
  }

  @Post('payments/:id/fail')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('payments.refund')
  @ApiParam({ name: 'id' })
  @ApiOperation({
    summary: 'Mark a payment failed',
    description:
      'For an attempt that will never complete — a refused delivery, or a ' +
      'gateway that went quiet. A collected payment cannot be failed; refund it ' +
      'instead, so the money leaves a trail.',
  })
  @ApiResponse({ status: 200, type: PaymentDto })
  @ApiResponse({ status: 422, description: 'The payment has already been collected.' })
  fail(
    @Param('id') id: string,
    @Body() dto: FailPaymentDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<PaymentDto> {
    return this.failPayment.execute(id, dto, actor);
  }

  @Post('payments/expire')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('payments.refund')
  @ApiOperation({
    summary: 'Close abandoned checkouts',
    description:
      'Fails attempts whose payment window has closed and releases the stock ' +
      'they were holding. Housekeeping — settling is idempotent, so a customer ' +
      'who paid in the last second of the window is unaffected.',
  })
  @ApiResponse({ status: 200, description: 'Number of attempts expired.' })
  expirePayments(): Promise<{ expired: number; settled: number }> {
    return this.expire.execute();
  }

  // ── Ledger ─────────────────────────────────────────────────

  @Get('transactions')
  @RequirePermissions('payments.read')
  @ApiOperation({
    summary: 'The transaction log',
    description:
      'Every movement of money on the platform: customer payments, refunds, ' +
      'commission and rider payouts. Append-only.',
  })
  @ApiPaginatedResponse(TransactionDto)
  transactions(@Query() query: ListTransactionsQueryDto): Promise<PaginatedResult<TransactionDto>> {
    return this.listTransactions.execute(query);
  }

  @Get('transactions/summary')
  @RequirePermissions('payments.read')
  @ApiOperation({
    summary: 'Money moved over a window',
    description:
      'Grouped by kind and state, with the headline figures a reconciliation ' +
      'starts from. Counts only what actually succeeded — a refund the gateway ' +
      'is still processing is money promised, not money gone.',
  })
  @ApiResponse({ status: 200, type: LedgerSummaryDto })
  summary(@Query() query: LedgerSummaryQueryDto): Promise<LedgerSummaryDto> {
    return this.ledger.execute(query);
  }

  // ── Invoices ───────────────────────────────────────────────

  @Get('invoices')
  @RequirePermissions('payments.read')
  @ApiOperation({ summary: 'All invoices', description: 'Filter by customer, state or date.' })
  @ApiPaginatedResponse(InvoiceSummaryDto)
  invoices(@Query() query: ListInvoicesQueryDto): Promise<PaginatedResult<InvoiceSummaryDto>> {
    return this.listInvoices.execute(query);
  }

  @Get('invoices/:orderId')
  @RequirePermissions('payments.read')
  @ApiParam({ name: 'orderId' })
  @ApiOperation({
    summary: 'The settlement invoice for any order',
    description: 'Every attempt, gateway reference and refund against the order.',
  })
  @ApiResponse({ status: 200, type: InvoiceDto })
  invoice(
    @Param('orderId') orderId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<InvoiceDto> {
    return this.getInvoice.execute(orderId, actor);
  }

  // ── Webhooks ───────────────────────────────────────────────

  @Get('webhooks')
  @RequirePermissions('payments.read')
  @ApiOperation({
    summary: 'Gateway callback log',
    description:
      'Everything a gateway has ever sent us, with the raw payload. This is ' +
      'what answers "the customer says they paid": filter by status=INVALID for ' +
      'signature problems, or FAILED for callbacks that were genuine but could ' +
      'not be applied.',
  })
  @ApiPaginatedResponse(WebhookEventDto)
  webhooks(@Query() query: ListWebhookEventsQueryDto): Promise<PaginatedResult<WebhookEventDto>> {
    return this.listWebhooks.execute(query);
  }

  @Post('webhooks/:id/replay')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('payments.refund')
  @ApiParam({ name: 'id' })
  @ApiOperation({
    summary: 'Re-apply a stored callback',
    description:
      'Replays the gateway’s original statement, for a settlement that failed ' +
      'for a reason since fixed. Because the raw payload was kept, nobody has ' +
      'to reconstruct what the gateway must have said.',
  })
  @ApiResponse({ status: 200, type: WebhookEventDto })
  replay(@Param('id') id: string): Promise<WebhookEventDto> {
    return this.replayWebhook.execute(id);
  }
}
