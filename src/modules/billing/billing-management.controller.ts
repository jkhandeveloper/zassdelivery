import { Body, Controller, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';

import { ApiPaginatedResponse } from '@/common/decorators/api-paginated-response.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { RequirePermissions } from '@/common/decorators/permissions.decorator';
import { ApiErrorResponseDto } from '@/common/dto/api-response.dto';
import { PaymentQrCodeDto, SetPaymentQrCodesDto } from '@/common/dto/payment-qr-code.dto';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import type { PaginatedResult } from '@/common/interfaces/paginated-result.interface';

import {
  DefaultFeeDto,
  SubscriptionDto,
  SubscriptionInvoiceDto,
} from './application/dto/billing-response.dto';
import {
  ListInvoicesQueryDto,
  ListSubscriptionsQueryDto,
  RecordPaymentDto,
  RejectTransferDto,
  SetDefaultFeeDto,
  SetMonthlyFeeDto,
  SuspendVendorDto,
  UpdatePaymentRecordDto,
  VoidInvoiceDto,
} from './application/dto/billing.dto';
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

/**
 * The platform's side of vendor subscriptions.
 *
 * Permission-guarded rather than role-guarded, and split on purpose:
 * `billing.read` is enough to work the queue and answer a vendor's question,
 * while `billing.manage` is what it takes to say money arrived, write a month
 * off, or put a vendor on a private rate.
 */
@ApiTags('Billing Management')
@ApiBearerAuth('access-token')
@ApiResponse({ status: 401, description: 'Not authenticated.', type: ApiErrorResponseDto })
@ApiResponse({ status: 403, description: 'Not permitted.', type: ApiErrorResponseDto })
@ApiResponse({ status: 404, description: 'Not found.', type: ApiErrorResponseDto })
@Controller('billing-management')
export class BillingManagementController {
  constructor(
    private readonly listSubscriptions: ListSubscriptionsUseCase,
    private readonly listInvoices: ListBillingInvoicesUseCase,
    private readonly confirm: ConfirmTransferUseCase,
    private readonly reject: RejectTransferUseCase,
    private readonly void_: VoidInvoiceUseCase,
    private readonly setFee: SetMonthlyFeeUseCase,
    private readonly suspendVendor: SuspendVendorUseCase,
    private readonly reinstateVendor: ReinstateVendorUseCase,
    private readonly getQrCodes: GetPlatformQrCodesUseCase,
    private readonly setQrCodes: SetPlatformQrCodesUseCase,
    private readonly recordPayment: RecordPaymentUseCase,
    private readonly updatePayment: UpdatePaymentRecordUseCase,
    private readonly getDefaultFee: GetDefaultFeeUseCase,
    private readonly setDefaultFee: SetDefaultFeeUseCase,
  ) {}

  @Get('subscriptions')
  @RequirePermissions('billing.read')
  @ApiOperation({
    summary: 'Every vendor subscription',
    description:
      'Ordered by whoever is closest to their next due date, because that is ' +
      'who is closest to being cut off. Search matches the listing name, the ' +
      'owner’s name or their phone number.',
  })
  @ApiPaginatedResponse(SubscriptionDto)
  subscriptions(
    @Query() query: ListSubscriptionsQueryDto,
  ): Promise<PaginatedResult<SubscriptionDto>> {
    return this.listSubscriptions.execute(query);
  }

  @Get('invoices')
  @RequirePermissions('billing.read')
  @ApiOperation({
    summary: 'The payment queue',
    description:
      'Filter to PENDING_REVIEW for transfers waiting to be checked. Search ' +
      'matches the invoice number or the transaction ID a vendor quoted.',
  })
  @ApiPaginatedResponse(SubscriptionInvoiceDto)
  invoices(@Query() query: ListInvoicesQueryDto): Promise<PaginatedResult<SubscriptionInvoiceDto>> {
    return this.listInvoices.execute(query);
  }

  @Post('invoices/:id/confirm')
  @RequirePermissions('billing.manage')
  @ApiOperation({
    summary: 'Confirm a transfer arrived',
    description:
      'Settles the invoice, rolls the vendor onto the month it buys, writes the ' +
      'fee to the ledger, and reopens the listing if non-payment is what closed ' +
      'it. A listing suspended for any other reason stays suspended.',
  })
  @ApiParam({ name: 'id' })
  @ApiResponse({ status: 201, type: SubscriptionInvoiceDto })
  confirmTransfer(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<SubscriptionInvoiceDto> {
    return this.confirm.execute(id, user);
  }

  @Post('invoices/:id/reject')
  @RequirePermissions('billing.manage')
  @ApiOperation({
    summary: 'Reject a transfer',
    description:
      'Returns the invoice to unpaid and tells the vendor why. If its grace ' +
      'window has already passed, the next nightly sweep closes the listing — ' +
      'which is the right answer to a transfer that never arrived.',
  })
  @ApiParam({ name: 'id' })
  @ApiResponse({ status: 201, type: SubscriptionInvoiceDto })
  rejectTransfer(
    @Param('id') id: string,
    @Body() dto: RejectTransferDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<SubscriptionInvoiceDto> {
    return this.reject.execute(id, dto, user);
  }

  @Post('invoices/:id/void')
  @RequirePermissions('billing.manage')
  @ApiOperation({
    summary: 'Waive an invoice',
    description:
      'Writes the month off. The vendor still gets the period it covered, so a ' +
      'waived invoice does not leave them to be suspended for it.',
  })
  @ApiParam({ name: 'id' })
  @ApiResponse({ status: 201, type: SubscriptionInvoiceDto })
  voidInvoice(
    @Param('id') id: string,
    @Body() dto: VoidInvoiceDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<SubscriptionInvoiceDto> {
    return this.void_.execute(id, dto, user);
  }

  @Patch('subscriptions/:id/fee')
  @RequirePermissions('billing.manage')
  @ApiOperation({
    summary: 'Set a vendor’s rate',
    description:
      'Puts this vendor on a negotiated monthly fee. Null returns them to the ' +
      'platform default, so a later price change reaches them with everyone else.',
  })
  @ApiParam({ name: 'id' })
  @ApiResponse({ status: 200, type: SubscriptionDto })
  monthlyFee(@Param('id') id: string, @Body() dto: SetMonthlyFeeDto): Promise<SubscriptionDto> {
    return this.setFee.execute(id, dto);
  }

  // ── Enabling and disabling an account ──────────────────────

  @Post('subscriptions/:id/disable')
  @RequirePermissions('billing.manage')
  @ApiOperation({
    summary: 'Close a vendor’s account',
    description:
      'Takes the listing down now, whatever its billing state. Recorded as the ' +
      'platform’s decision rather than the ledger’s, so paying an invoice will ' +
      'not reopen it — only an administrator can undo an administrator. The ' +
      'reason is shown to the vendor.',
  })
  @ApiParam({ name: 'id' })
  @ApiResponse({ status: 201, type: SubscriptionDto })
  disable(
    @Param('id') id: string,
    @Body() dto: SuspendVendorDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<SubscriptionDto> {
    return this.suspendVendor.execute(id, dto, user);
  }

  @Post('subscriptions/:id/enable')
  @RequirePermissions('billing.manage')
  @ApiOperation({
    summary: 'Reopen a vendor’s account',
    description:
      'Puts the listing back up, whatever took it down. An invoice still ' +
      'outstanding keeps its balance but gets a fresh grace window, so the ' +
      'nightly sweep does not close the vendor again before breakfast.',
  })
  @ApiParam({ name: 'id' })
  @ApiResponse({ status: 201, type: SubscriptionDto })
  enable(@Param('id') id: string): Promise<SubscriptionDto> {
    return this.reinstateVendor.execute(id);
  }

  // ── Where vendors pay us ───────────────────────────────────

  @Get('payment-qr-codes')
  @RequirePermissions('billing.read')
  @ApiOperation({
    summary: 'The platform’s own QR codes',
    description: 'What vendors are shown when they come to pay their monthly fee.',
  })
  @ApiResponse({ status: 200, type: [PaymentQrCodeDto] })
  paymentQrCodes(): Promise<PaymentQrCodeDto[]> {
    return this.getQrCodes.execute();
  }

  @Put('payment-qr-codes')
  @RequirePermissions('billing.manage')
  @ApiOperation({
    summary: 'Set the platform’s own QR codes',
    description:
      'Replaces the list wholesale, so a removed code is actually gone. An ' +
      'empty list means no vendor can pay — their screen says exactly that ' +
      'rather than showing a due date and nowhere to send the money.',
  })
  @ApiResponse({ status: 200, type: [PaymentQrCodeDto] })
  setPaymentQrCodes(
    @Body() dto: SetPaymentQrCodesDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PaymentQrCodeDto[]> {
    return this.setQrCodes.execute(dto, user);
  }

  // ── Payment records ────────────────────────────────────────

  @Post('invoices/:id/record-payment')
  @RequirePermissions('billing.manage')
  @ApiOperation({
    summary: 'Record a payment we received',
    description:
      'For money that arrives by phone, bank transfer or over the counter, ' +
      'without the vendor reporting it themselves. Settles the invoice through ' +
      'the same path as a confirmed transfer, so the ledger entry, the period ' +
      'roll and any reinstatement are identical. Backdate `paidAt` when you are ' +
      'entering a transfer that landed days ago.',
  })
  @ApiParam({ name: 'id' })
  @ApiResponse({ status: 201, type: SubscriptionInvoiceDto })
  @ApiResponse({
    status: 409,
    description: 'That transaction ID is already recorded elsewhere.',
    type: ApiErrorResponseDto,
  })
  record(
    @Param('id') id: string,
    @Body() dto: RecordPaymentDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<SubscriptionInvoiceDto> {
    return this.recordPayment.execute(id, dto, user);
  }

  @Patch('invoices/:id/payment')
  @RequirePermissions('billing.manage')
  @ApiOperation({
    summary: 'Correct a recorded payment',
    description:
      'Fixes a mistyped transaction ID, the wrong wallet or the wrong date on a ' +
      'payment already taken. The money moved once, so the ledger entry it wrote ' +
      'is left exactly as it is.',
  })
  @ApiParam({ name: 'id' })
  @ApiResponse({ status: 200, type: SubscriptionInvoiceDto })
  correctPayment(
    @Param('id') id: string,
    @Body() dto: UpdatePaymentRecordDto,
  ): Promise<SubscriptionInvoiceDto> {
    return this.updatePayment.execute(id, dto);
  }

  // ── The standard rate ──────────────────────────────────────

  @Get('default-fee')
  @RequirePermissions('billing.read')
  @ApiOperation({
    summary: 'The standard monthly fee',
    description: 'What a vendor pays unless they are on a rate of their own.',
  })
  @ApiResponse({ status: 200, type: DefaultFeeDto })
  defaultFee(): Promise<DefaultFeeDto> {
    return this.getDefaultFee.execute();
  }

  @Put('default-fee')
  @RequirePermissions('billing.manage')
  @ApiOperation({
    summary: 'Change the standard monthly fee',
    description:
      'Applies to every vendor without a negotiated rate, and re-prices the ' +
      'invoice they currently owe rather than waiting a month — then tells each ' +
      'of them what they now pay. Vendors on their own rate are untouched.',
  })
  @ApiResponse({ status: 200, type: DefaultFeeDto })
  changeDefaultFee(
    @Body() dto: SetDefaultFeeDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<DefaultFeeDto> {
    return this.setDefaultFee.execute(dto, user);
  }
}
