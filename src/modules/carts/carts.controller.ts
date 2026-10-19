import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { ApiErrorResponseDto } from '@/common/dto/api-response.dto';

import { MessageResponseDto } from '../auth/application/dto/auth-response.dto';
import { CartDto, CartRiderOptionDto, EmptyCartDto } from './application/dto/cart-response.dto';
import {
  AddCartItemDto,
  ApplyCouponDto,
  SetCartAddressDto,
  SetCartRiderDto,
  SetFulfilmentDto,
  SetTipDto,
  UpdateCartItemDto,
} from './application/dto/cart.dto';
import {
  AddCartItemUseCase,
  ApplyCouponUseCase,
  ClearCartUseCase,
  GetCartUseCase,
  ListCartRidersUseCase,
  RemoveCartItemUseCase,
  RemoveCouponUseCase,
  SetCartAddressUseCase,
  SetCartRiderUseCase,
  SetFulfilmentUseCase,
  SetTipUseCase,
  UpdateCartItemUseCase,
  ValidateCartUseCase,
} from './application/use-cases/cart.use-cases';

/**
 * The customer's basket. Every route operates on the caller's own cart — there
 * is no cart id in any path, so one customer cannot reach another's.
 *
 * Totals are recomputed from the live catalogue on every response rather than
 * stored, so a price or availability change upstream is reflected immediately
 * instead of leaving a stale figure in the basket.
 */
@ApiTags('Cart')
@ApiBearerAuth('access-token')
@ApiResponse({ status: 401, description: 'Not authenticated.', type: ApiErrorResponseDto })
@Controller('cart')
export class CartsController {
  constructor(
    private readonly getCart: GetCartUseCase,
    private readonly addItem: AddCartItemUseCase,
    private readonly updateItem: UpdateCartItemUseCase,
    private readonly removeItem: RemoveCartItemUseCase,
    private readonly clearCart: ClearCartUseCase,
    private readonly applyCoupon: ApplyCouponUseCase,
    private readonly removeCoupon: RemoveCouponUseCase,
    private readonly setAddress: SetCartAddressUseCase,
    private readonly setTip: SetTipUseCase,
    private readonly validateCart: ValidateCartUseCase,
    private readonly setFulfilment: SetFulfilmentUseCase,
    private readonly listRiders: ListCartRidersUseCase,
    private readonly setRider: SetCartRiderUseCase,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Get my cart',
    description:
      'Returns the basket with a full price breakdown and any outstanding ' +
      'issues. An empty cart is a normal state, not a 404.',
  })
  @ApiResponse({ status: 200, type: CartDto })
  get(@CurrentUser('id') userId: string): Promise<CartDto | EmptyCartDto> {
    return this.getCart.execute(userId);
  }

  @Post('items')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Add an item',
    description:
      'Adding a dish from a different business replaces the basket — a single ' +
      'order cannot span two kitchens. Identical selections merge into the ' +
      'existing line rather than stacking duplicates. Option-group rules ' +
      '(min/max selections) are enforced here.',
  })
  @ApiResponse({ status: 201, type: CartDto })
  @ApiResponse({
    status: 422,
    description: 'Unavailable dish, bad variant, or option rules unmet.',
  })
  add(@CurrentUser('id') userId: string, @Body() dto: AddCartItemDto): Promise<CartDto> {
    return this.addItem.execute(userId, dto);
  }

  @Patch('items/:itemId')
  @ApiParam({ name: 'itemId', description: 'Cart line id, not the menu item id.' })
  @ApiOperation({
    summary: 'Update a line quantity',
    description:
      'Sending 0 removes the line, which is how a quantity stepper reaching zero behaves.',
  })
  @ApiResponse({ status: 200, type: CartDto })
  @ApiResponse({ status: 404, description: 'No such line in your cart.' })
  update(
    @CurrentUser('id') userId: string,
    @Param('itemId') itemId: string,
    @Body() dto: UpdateCartItemDto,
  ): Promise<CartDto | EmptyCartDto> {
    return this.updateItem.execute(userId, itemId, dto);
  }

  @Delete('items/:itemId')
  @ApiParam({ name: 'itemId' })
  @ApiOperation({
    summary: 'Remove a line',
    description: 'Removing the last line discards the cart entirely.',
  })
  @ApiResponse({ status: 200, type: CartDto })
  remove(
    @CurrentUser('id') userId: string,
    @Param('itemId') itemId: string,
  ): Promise<CartDto | EmptyCartDto> {
    return this.removeItem.execute(userId, itemId);
  }

  @Delete()
  @ApiOperation({ summary: 'Empty the cart' })
  @ApiResponse({ status: 200, type: MessageResponseDto })
  clear(@CurrentUser('id') userId: string): Promise<MessageResponseDto> {
    return this.clearCart.execute(userId);
  }

  @Post('coupon')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Apply a coupon',
    description:
      'Checks the window, usage limits, per-user limit, first-order-only and ' +
      'restaurant/zone scope. Unknown and expired codes return the same message, ' +
      'so the endpoint cannot be used to discover which codes exist.',
  })
  @ApiResponse({ status: 200, type: CartDto })
  @ApiResponse({ status: 422, description: 'Coupon invalid, exhausted, or out of scope.' })
  coupon(@CurrentUser('id') userId: string, @Body() dto: ApplyCouponDto): Promise<CartDto> {
    return this.applyCoupon.execute(userId, dto);
  }

  @Delete('coupon')
  @ApiOperation({ summary: 'Remove the applied coupon' })
  @ApiResponse({ status: 200, type: CartDto })
  clearCoupon(@CurrentUser('id') userId: string): Promise<CartDto> {
    return this.removeCoupon.execute(userId);
  }

  @Patch('address')
  @ApiOperation({
    summary: 'Set the delivery address',
    description:
      'Drives the delivery fee and ETA. Must be one of your own saved addresses, ' +
      'and within the business’s delivery radius.',
  })
  @ApiResponse({ status: 200, type: CartDto })
  @ApiResponse({ status: 404, description: 'No such address of yours.' })
  address(@CurrentUser('id') userId: string, @Body() dto: SetCartAddressDto): Promise<CartDto> {
    return this.setAddress.execute(userId, dto);
  }

  @Patch('fulfilment')
  @ApiOperation({
    summary: 'Delivery or self-pickup',
    description:
      'PICKUP: you collect the order from the business yourself — no address, ' +
      'no delivery fee, no rider and no tip. DELIVERY brings it to your address.',
  })
  @ApiResponse({ status: 200, type: CartDto })
  fulfilment(@CurrentUser('id') userId: string, @Body() dto: SetFulfilmentDto): Promise<CartDto> {
    return this.setFulfilment.execute(userId, dto);
  }

  @Get('riders')
  @ApiOperation({
    summary: 'Riders I can choose',
    description:
      'Every rider free to deliver this order right now, with their own ' +
      'per-kilometre rate and what delivery to your address would cost with ' +
      'them. Cheap and dear riders alike — choose any. Empty for a pickup order.',
  })
  @ApiResponse({ status: 200, type: [CartRiderOptionDto] })
  riders(@CurrentUser('id') userId: string): Promise<CartRiderOptionDto[]> {
    return this.listRiders.execute(userId);
  }

  @Patch('rider')
  @ApiOperation({
    summary: 'Choose my rider',
    description:
      'The rider is offered the order first and the delivery fee is priced at ' +
      'their rate. Null lets dispatch find the nearest rider at the platform rate.',
  })
  @ApiResponse({ status: 200, type: CartDto })
  @ApiResponse({ status: 422, description: 'That rider is no longer available.' })
  rider(@CurrentUser('id') userId: string, @Body() dto: SetCartRiderDto): Promise<CartDto> {
    return this.setRider.execute(userId, dto);
  }

  @Patch('tip')
  @ApiOperation({ summary: 'Set the rider tip' })
  @ApiResponse({ status: 200, type: CartDto })
  tip(@CurrentUser('id') userId: string, @Body() dto: SetTipDto): Promise<CartDto> {
    return this.setTip.execute(userId, dto);
  }

  @Post('validate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Re-check the cart before checkout',
    description:
      'Revalidates against the live catalogue and returns every problem at once ' +
      'with a stable code, rather than failing on the first one. Gate the ' +
      'checkout button on canCheckout.',
  })
  @ApiResponse({ status: 200, type: CartDto })
  validate(@CurrentUser('id') userId: string): Promise<CartDto> {
    return this.validateCart.execute(userId);
  }
}
