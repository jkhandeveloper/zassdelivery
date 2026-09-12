import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';

import { ApiPaginatedResponse } from '@/common/decorators/api-paginated-response.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { Roles } from '@/common/decorators/roles.decorator';
import { ApiErrorResponseDto } from '@/common/dto/api-response.dto';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import type { PaginatedResult } from '@/common/interfaces/paginated-result.interface';

import { SubscriptionInvoiceDto, VendorBillingDto } from './application/dto/billing-response.dto';
import { ListInvoicesQueryDto, SubmitTransferDto } from './application/dto/billing.dto';
import {
  GetVendorBillingUseCase,
  ListVendorInvoicesUseCase,
  SubmitVendorTransferUseCase,
} from './application/use-cases/vendor-billing.use-cases';

/**
 * What a vendor owes the platform, and how they settle it.
 *
 * Owners only — `VENDOR_STAFF` is deliberately absent. A kitchen account runs
 * the menu and the order queue; what the owner pays for the listing is not its
 * business, and staff turnover should never expose the owner's billing.
 * Administrators are admitted because "why has my restaurant closed" is a
 * question support has to be able to answer.
 */
@ApiTags('Vendor Billing')
@ApiBearerAuth('access-token')
@ApiResponse({ status: 401, description: 'Not authenticated.', type: ApiErrorResponseDto })
@ApiResponse({ status: 403, description: 'Not permitted.', type: ApiErrorResponseDto })
@ApiResponse({ status: 404, description: 'Not found.', type: ApiErrorResponseDto })
@Roles(UserRole.VENDOR_OWNER, UserRole.ADMIN, UserRole.SUPER_ADMIN)
@Controller('vendor-billing')
export class VendorBillingController {
  constructor(
    private readonly getBilling: GetVendorBillingUseCase,
    private readonly listInvoices: ListVendorInvoicesUseCase,
    private readonly submitTransfer: SubmitVendorTransferUseCase,
  ) {}

  @Get('restaurants/:restaurantId')
  @ApiOperation({
    summary: 'This listing’s subscription',
    description:
      'Where the vendor stands, what is owed right now, and the QR codes to pay ' +
      'it with. The first month is free for every vendor and begins the day the ' +
      'listing is approved; after that a fixed 30-day cycle applies.',
  })
  @ApiParam({ name: 'restaurantId' })
  @ApiResponse({ status: 200, type: VendorBillingDto })
  billing(
    @Param('restaurantId') restaurantId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<VendorBillingDto> {
    return this.getBilling.execute(restaurantId, user);
  }

  @Get('restaurants/:restaurantId/invoices')
  @ApiOperation({
    summary: 'Billing history',
    description: 'Every month billed for this listing, the free first one included.',
  })
  @ApiParam({ name: 'restaurantId' })
  @ApiPaginatedResponse(SubscriptionInvoiceDto)
  invoices(
    @Param('restaurantId') restaurantId: string,
    @Query() query: ListInvoicesQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PaginatedResult<SubscriptionInvoiceDto>> {
    return this.listInvoices.execute(restaurantId, query, user);
  }

  @Post('invoices/:invoiceId/pay')
  @ApiOperation({
    summary: 'Report a transfer',
    description:
      'Tells us the fee has been sent, quoting the transaction ID. This does not ' +
      'settle the invoice — there is no gateway behind a QR transfer, so the ' +
      'platform confirms the money arrived before the account is marked paid.',
  })
  @ApiParam({ name: 'invoiceId' })
  @ApiResponse({ status: 201, type: SubscriptionInvoiceDto })
  @ApiResponse({
    status: 409,
    description: 'That transaction ID has already been used.',
    type: ApiErrorResponseDto,
  })
  pay(
    @Param('invoiceId') invoiceId: string,
    @Body() dto: SubmitTransferDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<SubscriptionInvoiceDto> {
    return this.submitTransfer.execute(invoiceId, dto, user);
  }
}
