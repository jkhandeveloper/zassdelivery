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
import { CartDto, EmptyCartDto } from './application/dto/cart-response.dto';
import {
  AddCartItemDto,
  ApplyCouponDto,
  SetCartAddressDto,
  SetTipDto,
  UpdateCartItemDto,
} from './application/dto/cart.dto';
import {
  AddCartItemUseCase,
  ApplyCouponUseCase,
  ClearCartUseCase,
  GetCartUseCase,
  RemoveCartItemUseCase,
  RemoveCouponUseCase,
  SetCartAddressUseCase,
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
      'Adding a dish from a different restaurant replaces the basket — a single ' +
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
      'and within the restaurant’s delivery radius.',
  })
  @ApiResponse({ status: 200, type: CartDto })
  @ApiResponse({ status: 404, description: 'No such address of yours.' })
  address(@CurrentUser('id') userId: string, @Body() dto: SetCartAddressDto): Promise<CartDto> {
    return this.setAddress.execute(userId, dto);
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
