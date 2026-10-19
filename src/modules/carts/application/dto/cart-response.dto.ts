import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { OrderType, VehicleType } from '@prisma/client';

export class CartAddOnDto {
  @ApiProperty() id!: string;
  @ApiProperty() addOnId!: string;
  @ApiProperty({ example: 'Extra Cheese' }) name!: string;
  @ApiProperty({ example: 150 }) price!: number;
  @ApiProperty({ example: 1 }) quantity!: number;
  @ApiProperty({ example: true }) isAvailable!: boolean;
}

export class CartLineDto {
  @ApiProperty() id!: string;
  @ApiProperty() menuItemId!: string;
  @ApiProperty({ example: 'Chapli Kabab' }) name!: string;
  @ApiPropertyOptional({ nullable: true }) imageUrl!: string | null;
  @ApiPropertyOptional({ nullable: true, example: 'Plate of 3' }) variantName!: string | null;
  @ApiPropertyOptional({ nullable: true }) variantId!: string | null;

  @ApiProperty({
    example: 700,
    description: 'Variant price when chosen, otherwise the dish price.',
  })
  unitPrice!: number;

  @ApiProperty({ example: 60 }) addOnsTotal!: number;
  @ApiProperty({ example: 1 }) quantity!: number;
  @ApiProperty({ example: 760, description: '(unitPrice + addOnsTotal) × quantity.' })
  lineTotal!: number;

  @ApiPropertyOptional({ nullable: true }) notes!: string | null;
  @ApiProperty({ type: [CartAddOnDto] }) addOns!: CartAddOnDto[];

  @ApiProperty({ example: true, description: 'Whether this line can still be ordered.' })
  isAvailable!: boolean;
}

export class CartTotalsDto {
  @ApiProperty({ example: 910 }) subtotal!: number;
  @ApiProperty({ example: 100 }) discountAmount!: number;
  @ApiProperty({ example: 69 }) deliveryFee!: number;
  @ApiProperty({ example: 41 }) serviceFee!: number;
  @ApiProperty({ example: 0 }) taxAmount!: number;
  @ApiProperty({ example: 0 }) tipAmount!: number;

  @ApiProperty({
    example: 920,
    description: 'subtotal − discount + delivery + service + tax + tip.',
  })
  totalAmount!: number;

  @ApiPropertyOptional({
    nullable: true,
    enum: ['threshold', 'coupon'],
    description: 'Why delivery was free, when it was.',
  })
  freeDeliveryReason!: string | null;

  @ApiProperty({ example: 2 }) itemCount!: number;
  @ApiProperty({ example: 3 }) totalQuantity!: number;
}

export class CartIssueDto {
  @ApiProperty({ example: 'INSUFFICIENT_STOCK' }) code!: string;
  @ApiProperty({ example: 'Only 2 of Chapli Kabab left; your cart has 3.' }) message!: string;
  @ApiPropertyOptional({ nullable: true }) cartItemId?: string;
  @ApiProperty({ example: true, description: 'Must be resolved before checkout.' })
  blocking!: boolean;
}

export class CartRestaurantDto {
  @ApiProperty() id!: string;
  @ApiProperty({ example: 'Chapli Kabab House' }) name!: string;
  @ApiProperty({ example: 'chapli-kabab-house-pabbi' }) slug!: string;
  @ApiPropertyOptional({ nullable: true }) logoUrl!: string | null;
  @ApiProperty({ example: 250 }) minOrderAmount!: number;
  @ApiProperty({ example: 25 }) avgPreparationMinutes!: number;
  @ApiProperty({ example: true }) isAcceptingOrders!: boolean;
}

export class CartDeliveryDto {
  @ApiPropertyOptional({ nullable: true }) addressId!: string | null;
  @ApiPropertyOptional({ nullable: true, example: 'House 14, Street 3' }) addressLine!:
    | string
    | null;
  @ApiPropertyOptional({ nullable: true, example: 2.4 }) distanceKm!: number | null;
  @ApiPropertyOptional({ nullable: true, example: 35 }) etaMinutes!: number | null;

  @ApiProperty({
    example: true,
    description: 'False when the address lies outside the deliverable area.',
  })
  isDeliverable!: boolean;
}

export class CartRiderDto {
  @ApiProperty() id!: string;
  @ApiProperty({ example: 'Bilal Ahmed' }) fullName!: string;
  @ApiPropertyOptional({ nullable: true }) avatarUrl!: string | null;
  @ApiProperty({ example: 4.8 }) rating!: number;
  @ApiPropertyOptional({ enum: VehicleType, nullable: true }) vehicleType!: VehicleType | null;
  @ApiPropertyOptional({
    nullable: true,
    example: 60,
    description: 'The rider’s own rate per kilometre. Null charges the platform rate.',
  })
  perKmRate!: number | null;
}

/** One rider on the checkout's "choose your rider" list. */
export class CartRiderOptionDto extends CartRiderDto {
  @ApiProperty({ example: 132 }) ratingCount!: number;
  @ApiProperty({ example: 486 }) totalDeliveries!: number;

  @ApiProperty({ example: 1.2, description: 'How far the rider is from the business.' })
  distanceToPickupKm!: number;

  @ApiPropertyOptional({
    nullable: true,
    example: 120,
    description:
      'What delivery would cost with this rider, to the cart’s address. Null until ' +
      'an address is chosen, or when this rider cannot reach it.',
  })
  deliveryFee!: number | null;

  @ApiProperty({ description: 'Whether this is the rider currently chosen.' })
  isSelected!: boolean;
}

export class CartDto {
  @ApiProperty() id!: string;
  @ApiProperty({ type: CartRestaurantDto }) restaurant!: CartRestaurantDto;
  @ApiProperty({ type: [CartLineDto] }) items!: CartLineDto[];
  @ApiProperty({ type: CartTotalsDto }) totals!: CartTotalsDto;
  @ApiProperty({ type: CartDeliveryDto }) delivery!: CartDeliveryDto;

  @ApiProperty({
    enum: OrderType,
    description: 'DELIVERY to the chosen address, or PICKUP: the customer collects it.',
  })
  fulfilment!: OrderType;

  @ApiPropertyOptional({
    type: CartRiderDto,
    nullable: true,
    description: 'The rider the customer chose. Null lets dispatch pick one.',
  })
  rider!: CartRiderDto | null;

  @ApiPropertyOptional({ nullable: true, example: 'ZASS100' }) couponCode!: string | null;
  @ApiPropertyOptional({ nullable: true }) notes!: string | null;

  @ApiProperty({
    type: [CartIssueDto],
    description: 'Everything wrong with the basket right now, reported together.',
  })
  issues!: CartIssueDto[];

  @ApiProperty({
    example: true,
    description:
      'True only when there are no blocking issues and the minimum order is met — ' +
      'the single flag a client should gate the checkout button on.',
  })
  canCheckout!: boolean;

  @ApiProperty() expiresAt!: Date;
}

export class EmptyCartDto {
  @ApiProperty({ example: null, nullable: true }) id!: null;
  @ApiProperty({ example: true }) isEmpty!: true;
  @ApiProperty({ example: 'Your cart is empty.' }) message!: string;
}
