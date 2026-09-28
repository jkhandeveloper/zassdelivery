import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';

import { ApiPaginatedResponse } from '@/common/decorators/api-paginated-response.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { Roles } from '@/common/decorators/roles.decorator';
import { ApiErrorResponseDto } from '@/common/dto/api-response.dto';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import type { PaginatedResult } from '@/common/interfaces/paginated-result.interface';

import {
  RiderBalanceDto,
  RiderLedgerEntryDto,
  RiderSettlementDto,
} from './application/dto/rider-response.dto';
import { ListSettlementQueryDto, RecordCashReceivedDto } from './application/dto/rider.dto';
import { RestaurantSettlementUseCases } from './application/use-cases/settlement.use-cases';

/**
 * What a restaurant and the riders who deliver for it owe each other.
 *
 * A rider who collected cash owes the restaurant the order total minus their
 * delivery fee and tip. A rider who delivered an order the restaurant was paid
 * for directly is owed that fee. The platform keeps score; it never holds the
 * money.
 *
 * Staff are admitted alongside the owner: cash usually changes hands at the
 * counter, with whoever is on shift.
 */
@ApiTags('Rider Settlements')
@ApiBearerAuth('access-token')
@ApiResponse({ status: 401, description: 'Not authenticated.', type: ApiErrorResponseDto })
@ApiResponse({ status: 403, description: 'Not permitted.', type: ApiErrorResponseDto })
@ApiResponse({ status: 404, description: 'Not found.', type: ApiErrorResponseDto })
@Roles(UserRole.VENDOR_OWNER, UserRole.VENDOR_STAFF, UserRole.ADMIN, UserRole.SUPER_ADMIN)
@Controller('restaurants/:restaurantId/rider-settlements')
export class RestaurantRiderSettlementsController {
  constructor(private readonly settlement: RestaurantSettlementUseCases) {}

  @Get()
  @ApiParam({ name: 'restaurantId' })
  @ApiOperation({
    summary: 'Balances with each rider',
    description:
      'One row per rider. A positive balance is cash the rider still has to hand ' +
      'over; a negative one is delivery fees you still owe them.',
  })
  @ApiResponse({ status: 200, type: [RiderBalanceDto] })
  balances(
    @Param('restaurantId') restaurantId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<RiderBalanceDto[]> {
    return this.settlement.balances(restaurantId, actor);
  }

  @Get('entries')
  @ApiParam({ name: 'restaurantId' })
  @ApiOperation({
    summary: 'Per-order statement',
    description: 'What each delivered order added to the balance. Filter with driverId.',
  })
  @ApiPaginatedResponse(RiderLedgerEntryDto)
  entries(
    @Param('restaurantId') restaurantId: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: ListSettlementQueryDto,
  ): Promise<PaginatedResult<RiderLedgerEntryDto>> {
    return this.settlement.entries(restaurantId, actor, query);
  }

  @Get('payments')
  @ApiParam({ name: 'restaurantId' })
  @ApiOperation({
    summary: 'Money that changed hands',
    description: 'Cash riders handed over and fees you paid them. Filter with driverId.',
  })
  @ApiPaginatedResponse(RiderSettlementDto)
  payments(
    @Param('restaurantId') restaurantId: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: ListSettlementQueryDto,
  ): Promise<PaginatedResult<RiderSettlementDto>> {
    return this.settlement.settlements(restaurantId, actor, query);
  }

  @Post('cash-received')
  @HttpCode(HttpStatus.CREATED)
  @ApiParam({ name: 'restaurantId' })
  @ApiOperation({
    summary: 'Confirm cash a rider handed over',
    description:
      'Only the business can confirm money that reached it. Fees you pay a ' +
      'rider are confirmed by the rider from their app instead. The amount ' +
      'cannot exceed what the rider currently owes you.',
  })
  @ApiResponse({ status: 201, type: RiderSettlementDto })
  @ApiResponse({ status: 422, description: 'More than the rider owes you.' })
  cashReceived(
    @Param('restaurantId') restaurantId: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: RecordCashReceivedDto,
  ): Promise<RiderSettlementDto> {
    return this.settlement.recordCashReceived(restaurantId, actor, dto);
  }
}
