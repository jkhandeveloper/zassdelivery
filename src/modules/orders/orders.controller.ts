import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { OrderStatus } from '@prisma/client';

import { ApiPaginatedResponse } from '@/common/decorators/api-paginated-response.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { ApiErrorResponseDto } from '@/common/dto/api-response.dto';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import type { PaginatedResult } from '@/common/interfaces/paginated-result.interface';

import {
  InvoiceDto,
  OrderDto,
  OrderTimelineEntryDto,
  OrderTransactionDto,
} from './application/dto/order-response.dto';
import { CancelOrderDto, ListOrdersQueryDto, PlaceOrderDto } from './application/dto/order.dto';
import {
  CancelOrderUseCase,
  GetOrderUseCase,
  ListOrdersUseCase,
  OrderInvoiceUseCase,
  OrderTimelineUseCase,
  OrderTransactionsUseCase,
} from './application/use-cases/order-lifecycle.use-cases';
import { PlaceOrderUseCase } from './application/use-cases/place-order.use-case';

/**
 * The customer's own orders.
 *
 * Every route resolves the caller's relationship to the order before answering,
 * and returns 404 rather than 403 for one that is none of their business —
 * confirming an id exists is itself a disclosure.
 */
@ApiTags('Orders')
@ApiBearerAuth('access-token')
@ApiResponse({ status: 401, description: 'Not authenticated.', type: ApiErrorResponseDto })
@Controller('orders')
export class OrdersController {
  constructor(
    private readonly placeOrder: PlaceOrderUseCase,
    private readonly listOrders: ListOrdersUseCase,
    private readonly getOrder: GetOrderUseCase,
    private readonly cancelOrder: CancelOrderUseCase,
    private readonly timeline: OrderTimelineUseCase,
    private readonly transactions: OrderTransactionsUseCase,
    private readonly invoice: OrderInvoiceUseCase,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Place an order from the cart',
    description:
      'The basket is re-validated and re-priced server-side; nothing about the ' +
      'total comes from the client. Writes the order, its lines, the opening ' +
      'timeline entry, the payment row, stock decrements and coupon accounting ' +
      'in one transaction, then clears the cart.',
  })
  @ApiResponse({ status: 201, type: OrderDto })
  @ApiResponse({
    status: 422,
    description: 'Empty cart, unresolved cart issues, or sold-out item.',
  })
  place(@CurrentUser('id') userId: string, @Body() dto: PlaceOrderDto): Promise<OrderDto> {
    return this.placeOrder.execute(userId, dto);
  }

  @Get()
  @ApiOperation({
    summary: 'My order history',
    description: 'Always scoped to the caller, whatever the query string says.',
  })
  @ApiPaginatedResponse(OrderDto)
  history(
    @CurrentUser('id') userId: string,
    @Query() query: ListOrdersQueryDto,
  ): Promise<PaginatedResult<OrderDto>> {
    return this.listOrders.execute(query, { customerId: userId });
  }

  @Get(':id')
  @ApiParam({ name: 'id' })
  @ApiOperation({
    summary: 'Get an order',
    description:
      'Includes the timeline and the transitions available to *you*, so a client ' +
      'can render its action buttons straight from the response.',
  })
  @ApiResponse({ status: 200, type: OrderDto })
  @ApiResponse({ status: 404, description: 'No such order of yours.' })
  detail(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser): Promise<OrderDto> {
    return this.getOrder.execute(id, actor);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'id' })
  @ApiOperation({
    summary: 'Cancel an order',
    description:
      'Free within the cancellation window and before the kitchen starts ' +
      'cooking. Once preparation has begun the food is already a cost someone ' +
      'must bear, so cancelling becomes an operator decision. Stock is returned ' +
      'only if it was never committed.',
  })
  @ApiResponse({ status: 200, type: OrderDto })
  @ApiResponse({ status: 403, description: 'Outside the window, or already being prepared.' })
  cancel(
    @Param('id') id: string,
    @Body() dto: CancelOrderDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<OrderDto> {
    return this.cancelOrder.execute(id, actor, dto.reason);
  }

  @Get(':id/timeline')
  @ApiParam({ name: 'id' })
  @ApiOperation({
    summary: 'Order timeline',
    description: 'Append-only trail of every status change, with who made it.',
  })
  @ApiResponse({ status: 200, type: [OrderTimelineEntryDto] })
  getTimeline(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.timeline.execute(id, actor);
  }

  @Get(':id/transactions')
  @ApiParam({ name: 'id' })
  @ApiOperation({
    summary: 'Money movements for an order',
    description:
      'Payments, commission and refunds. Visible to the customer who paid and ' +
      'to staff; the kitchen and rider have no business seeing it.',
  })
  @ApiResponse({ status: 200, type: [OrderTransactionDto] })
  getTransactions(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.transactions.execute(id, actor);
  }

  @Get(':id/invoice')
  @ApiParam({ name: 'id' })
  @ApiOperation({
    summary: 'Order invoice',
    description:
      'The order number doubles as the invoice number, so customer, kitchen and ' +
      'support all quote one reference.',
  })
  @ApiResponse({ status: 200, type: InvoiceDto })
  @ApiResponse({ status: 422, description: 'The order has not been placed yet.' })
  getInvoice(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<InvoiceDto> {
    return this.invoice.execute(id, actor);
  }
}

/** Exposed for the management controller's Swagger enum. */
export const LIFECYCLE_STATUSES = OrderStatus;
