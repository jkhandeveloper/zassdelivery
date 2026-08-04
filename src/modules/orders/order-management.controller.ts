import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { OrderStatus } from '@prisma/client';

import { ApiPaginatedResponse } from '@/common/decorators/api-paginated-response.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { RequirePermissions } from '@/common/decorators/permissions.decorator';
import { ApiErrorResponseDto } from '@/common/dto/api-response.dto';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import type { PaginatedResult } from '@/common/interfaces/paginated-result.interface';

import { OrderDto } from './application/dto/order-response.dto';
import {
  AdvanceOrderDto,
  CancelOrderDto,
  ListOrdersAdminQueryDto,
  RefundOrderDto,
  RejectOrderDto,
} from './application/dto/order.dto';
import {
  AdvanceOrderUseCase,
  CancelOrderUseCase,
  ListOrdersUseCase,
  RefundOrderUseCase,
} from './application/use-cases/order-lifecycle.use-cases';

/**
 * Lifecycle operations for restaurants, riders and staff.
 *
 * Every route funnels through the same state machine, which decides both
 * whether a move is legal and whether this caller may make it — so a rider
 * cannot accept an order on the kitchen's behalf, and a customer cannot mark
 * their own delivered.
 */
@ApiTags('Order Management')
@ApiBearerAuth('access-token')
@ApiResponse({ status: 401, description: 'Not authenticated.', type: ApiErrorResponseDto })
@ApiResponse({ status: 404, description: 'Not found, or not yours.', type: ApiErrorResponseDto })
@ApiResponse({
  status: 422,
  description: 'Illegal transition for your role.',
  type: ApiErrorResponseDto,
})
@Controller('order-management')
export class OrderManagementController {
  constructor(
    private readonly listOrders: ListOrdersUseCase,
    private readonly advance: AdvanceOrderUseCase,
    private readonly cancel: CancelOrderUseCase,
    private readonly refund: RefundOrderUseCase,
  ) {}

  @Get('restaurants/:restaurantId')
  @ApiParam({ name: 'restaurantId' })
  @ApiOperation({
    summary: 'Orders for a restaurant',
    description: 'Use activeOnly=true for the kitchen dashboard.',
  })
  @ApiPaginatedResponse(OrderDto)
  forRestaurant(
    @Param('restaurantId') restaurantId: string,
    @Query() query: ListOrdersAdminQueryDto,
  ): Promise<PaginatedResult<OrderDto>> {
    return this.listOrders.execute(query, { restaurantId });
  }

  @Get('drivers/:driverId')
  @ApiParam({ name: 'driverId' })
  @ApiOperation({ summary: 'Deliveries for a rider' })
  @ApiPaginatedResponse(OrderDto)
  forDriver(
    @Param('driverId') driverId: string,
    @Query() query: ListOrdersAdminQueryDto,
  ): Promise<PaginatedResult<OrderDto>> {
    return this.listOrders.execute(query, { driverId });
  }

  @Get()
  @RequirePermissions('orders.read')
  @ApiOperation({
    summary: 'All orders',
    description: 'Staff view across every restaurant, rider and customer.',
  })
  @ApiPaginatedResponse(OrderDto)
  all(@Query() query: ListOrdersAdminQueryDto): Promise<PaginatedResult<OrderDto>> {
    return this.listOrders.execute(query);
  }

  // ── Restaurant actions ─────────────────────────────────────

  @Post(':id/accept')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: 'Accept an order', description: 'PLACED → CONFIRMED.' })
  @ApiResponse({ status: 200, type: OrderDto })
  accept(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser): Promise<OrderDto> {
    return this.advance.execute(id, OrderStatus.CONFIRMED, actor);
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'id' })
  @ApiOperation({
    summary: 'Reject an order',
    description: 'PLACED → REJECTED. The reason is shown to the customer, and stock is returned.',
  })
  @ApiResponse({ status: 200, type: OrderDto })
  reject(
    @Param('id') id: string,
    @Body() dto: RejectOrderDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<OrderDto> {
    return this.advance.execute(id, OrderStatus.REJECTED, actor, { reason: dto.reason });
  }

  @Post(':id/preparing')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'id' })
  @ApiOperation({
    summary: 'Start preparing',
    description: 'CONFIRMED → PREPARING. Free customer cancellation ends here.',
  })
  @ApiResponse({ status: 200, type: OrderDto })
  preparing(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser): Promise<OrderDto> {
    return this.advance.execute(id, OrderStatus.PREPARING, actor);
  }

  @Post(':id/ready')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: 'Mark ready for pickup', description: 'PREPARING → READY_FOR_PICKUP.' })
  @ApiResponse({ status: 200, type: OrderDto })
  ready(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser): Promise<OrderDto> {
    return this.advance.execute(id, OrderStatus.READY_FOR_PICKUP, actor);
  }

  // ── Rider actions ──────────────────────────────────────────

  @Post(':id/pickup')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'id' })
  @ApiOperation({
    summary: 'Collect the order',
    description: 'READY_FOR_PICKUP → PICKED_UP. Only the assigned rider may do this.',
  })
  @ApiResponse({ status: 200, type: OrderDto })
  pickup(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser): Promise<OrderDto> {
    return this.advance.execute(id, OrderStatus.PICKED_UP, actor);
  }

  @Post(':id/on-the-way')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: 'Start the delivery run', description: 'PICKED_UP → ON_THE_WAY.' })
  @ApiResponse({ status: 200, type: OrderDto })
  onTheWay(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser): Promise<OrderDto> {
    return this.advance.execute(id, OrderStatus.ON_THE_WAY, actor);
  }

  @Post(':id/delivered')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'id' })
  @ApiOperation({
    summary: 'Mark delivered',
    description:
      'ON_THE_WAY → DELIVERED. For cash orders this is also when payment is ' +
      'settled and the commission entry is confirmed.',
  })
  @ApiResponse({ status: 200, type: OrderDto })
  delivered(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser): Promise<OrderDto> {
    return this.advance.execute(id, OrderStatus.DELIVERED, actor);
  }

  // ── Staff actions ──────────────────────────────────────────

  @Patch(':id/status')
  @ApiParam({ name: 'id' })
  @ApiOperation({
    summary: 'Move an order to any legal next status',
    description: 'The escape hatch for support. Still validated by the state machine.',
  })
  @ApiResponse({ status: 200, type: OrderDto })
  status(
    @Param('id') id: string,
    @Body() dto: AdvanceOrderDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<OrderDto> {
    return this.advance.execute(id, dto.status, actor, { note: dto.note });
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: 'Cancel on behalf of the customer' })
  @ApiResponse({ status: 200, type: OrderDto })
  cancelOrder(
    @Param('id') id: string,
    @Body() dto: CancelOrderDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<OrderDto> {
    return this.cancel.execute(id, actor, dto.reason);
  }

  @Post(':id/refund')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('payments.refund')
  @ApiParam({ name: 'id' })
  @ApiOperation({
    summary: 'Refund an order',
    description:
      'Credits the customer’s wallet and posts a ledger entry. Additive rather ' +
      'than a status change: a delivered order stays delivered and the ' +
      'correction lives in the transaction trail. Partial refunds accumulate ' +
      'and can never exceed what was paid.',
  })
  @ApiResponse({ status: 200, description: 'Refund issued.' })
  @ApiResponse({ status: 422, description: 'Unpaid, already fully refunded, or amount too large.' })
  refundOrder(
    @Param('id') id: string,
    @Body() dto: RefundOrderDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<{ message: string; refunded: number; totalRefunded: number }> {
    return this.refund.execute(id, actor, dto.amount, dto.reason);
  }
}
