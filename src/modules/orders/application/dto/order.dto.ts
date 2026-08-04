import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { OrderStatus, PaymentMethod } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsDate,
  IsEnum,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

import { PaginationQueryDto } from '@/common/dto/pagination-query.dto';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

const toBoolean = ({ value }: { value: unknown }): unknown => {
  if (typeof value === 'boolean') {
    return value;
  }
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  return value;
};

/** Payment methods a customer may choose at checkout. */
const CUSTOMER_PAYMENT_METHODS = [
  PaymentMethod.CASH_ON_DELIVERY,
  PaymentMethod.WALLET,
  PaymentMethod.JAZZCASH,
  PaymentMethod.EASYPAISA,
] as const;

export class PlaceOrderDto {
  @ApiProperty({
    enum: CUSTOMER_PAYMENT_METHODS,
    default: PaymentMethod.CASH_ON_DELIVERY,
    description:
      'Cash and wallet settle here and the order goes straight to the ' +
      'restaurant. JazzCash and Easypaisa hold the order in PENDING_PAYMENT ' +
      'until the money lands — start the payment with ' +
      'POST /payments/orders/{orderId}/checkout and send the customer to the gateway.',
  })
  @IsOptional()
  @IsIn(CUSTOMER_PAYMENT_METHODS, {
    message: `paymentMethod must be one of: ${CUSTOMER_PAYMENT_METHODS.join(', ')}`,
  })
  paymentMethod?: (typeof CUSTOMER_PAYMENT_METHODS)[number];

  @ApiPropertyOptional({ example: 'Please ring the bell twice.', maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Transform(trim)
  customerNote?: string;
}

export class CancelOrderDto {
  @ApiPropertyOptional({
    example: 'Ordered by mistake',
    description: 'Recorded on the order and shown to the restaurant.',
    maxLength: 300,
  })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  @Transform(trim)
  reason?: string;
}

export class RejectOrderDto {
  @ApiProperty({
    description: 'Shown to the customer, so a rejection is not a dead end.',
    example: 'We have run out of chapli kabab for tonight.',
    maxLength: 300,
  })
  @IsString()
  @MinLength(5, { message: 'reason must explain why the order was rejected' })
  @MaxLength(300)
  @Transform(trim)
  reason!: string;
}

export class AdvanceOrderDto {
  @ApiProperty({
    enum: OrderStatus,
    description: 'Target status. Illegal transitions are rejected by the state machine.',
  })
  @IsEnum(OrderStatus)
  status!: OrderStatus;

  @ApiPropertyOptional({ maxLength: 300 })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  @Transform(trim)
  note?: string;
}

export class RefundOrderDto {
  @ApiPropertyOptional({
    description:
      'Amount in PKR. Omit for a full refund of whatever has not already been ' + 'returned.',
    example: 250,
    minimum: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  @Max(1000000)
  amount?: number;

  @ApiProperty({ example: 'Items missing from the delivered order.', maxLength: 300 })
  @IsString()
  @MinLength(5)
  @MaxLength(300)
  @Transform(trim)
  reason!: string;
}

export const ORDER_SORT_FIELDS = ['createdAt', 'totalAmount', 'deliveredAt'] as const;

export class ListOrdersQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Matches the order number.',
    example: 'ZD-260804',
  })
  declare search?: string;

  @ApiPropertyOptional({ enum: ORDER_SORT_FIELDS, default: 'createdAt' })
  @IsOptional()
  @IsIn(ORDER_SORT_FIELDS, { message: `sortBy must be one of: ${ORDER_SORT_FIELDS.join(', ')}` })
  declare sortBy?: (typeof ORDER_SORT_FIELDS)[number];

  @ApiPropertyOptional({ enum: OrderStatus })
  @IsOptional()
  @IsEnum(OrderStatus)
  status?: OrderStatus;

  @ApiPropertyOptional({
    description: 'Only orders still in flight — the kitchen and rider dashboards.',
    default: false,
  })
  @IsOptional()
  @Transform(toBoolean)
  activeOnly?: boolean;

  @ApiPropertyOptional({ example: '2026-08-01T00:00:00.000Z' })
  @IsOptional()
  @Type(() => Date)
  @IsDate({ message: 'from must be a valid ISO 8601 date' })
  from?: Date;

  @ApiPropertyOptional({ example: '2026-08-31T23:59:59.999Z' })
  @IsOptional()
  @Type(() => Date)
  @IsDate({ message: 'to must be a valid ISO 8601 date' })
  to?: Date;
}

/** Staff listing: adds cross-tenant filters. */
export class ListOrdersAdminQueryDto extends ListOrdersQueryDto {
  @ApiPropertyOptional({ description: 'Filter by restaurant.' })
  @IsOptional()
  @IsString()
  restaurantId?: string;

  @ApiPropertyOptional({ description: 'Filter by rider.' })
  @IsOptional()
  @IsString()
  driverId?: string;

  @ApiPropertyOptional({ description: 'Filter by customer.' })
  @IsOptional()
  @IsString()
  customerId?: string;
}
