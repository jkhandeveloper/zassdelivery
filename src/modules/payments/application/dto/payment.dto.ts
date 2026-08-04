import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  PaymentMethod,
  PaymentStatus,
  TransactionStatus,
  TransactionType,
  WebhookStatus,
} from '@prisma/client';
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

/** Methods a customer may start a payment with from the app. */
const CUSTOMER_METHODS = [
  PaymentMethod.CASH_ON_DELIVERY,
  PaymentMethod.WALLET,
  PaymentMethod.JAZZCASH,
  PaymentMethod.EASYPAISA,
] as const;

export class StartCheckoutDto {
  @ApiProperty({
    enum: CUSTOMER_METHODS,
    description:
      'How the customer wants to pay. Cash and wallet settle in-house; ' +
      'JazzCash and Easypaisa return checkout parameters to post to the gateway.',
  })
  @IsIn(CUSTOMER_METHODS, {
    message: `method must be one of: ${CUSTOMER_METHODS.join(', ')}`,
  })
  method!: (typeof CUSTOMER_METHODS)[number];
}

export class RefundPaymentDto {
  @ApiPropertyOptional({
    description: 'Amount in PKR. Omit to refund everything not already returned.',
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

  @ApiPropertyOptional({
    enum: ['SOURCE', 'WALLET'],
    default: 'SOURCE',
    description:
      'SOURCE returns the money the way it arrived, falling back to the wallet ' +
      'when the gateway cannot take it. WALLET always credits the in-app wallet, ' +
      'which is instant but keeps the money on the platform.',
  })
  @IsOptional()
  @IsIn(['SOURCE', 'WALLET'])
  destination?: 'SOURCE' | 'WALLET';
}

export class MarkPaymentPaidDto {
  @ApiProperty({
    example: 'Bank transfer received, ref IBFT-88123.',
    description: 'Why this payment is being settled by hand. Recorded on the ledger entry.',
    maxLength: 300,
  })
  @IsString()
  @MinLength(5)
  @MaxLength(300)
  @Transform(trim)
  reason!: string;

  @ApiPropertyOptional({
    example: 'IBFT-88123',
    description: 'The provider or bank reference, when there is one.',
    maxLength: 120,
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Transform(trim)
  gatewayTransactionId?: string;
}

export class FailPaymentDto {
  @ApiProperty({ example: 'Customer refused delivery.', maxLength: 300 })
  @IsString()
  @MinLength(5)
  @MaxLength(300)
  @Transform(trim)
  reason!: string;
}

// ── Queries ────────────────────────────────────────────────────

export const PAYMENT_SORT_FIELDS = ['createdAt', 'amount', 'paidAt'] as const;

export class ListPaymentsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Matches our reference, the gateway transaction id, or the order number.',
    example: 'PAY-260810',
  })
  declare search?: string;

  @ApiPropertyOptional({ enum: PAYMENT_SORT_FIELDS, default: 'createdAt' })
  @IsOptional()
  @IsIn(PAYMENT_SORT_FIELDS, {
    message: `sortBy must be one of: ${PAYMENT_SORT_FIELDS.join(', ')}`,
  })
  declare sortBy?: (typeof PAYMENT_SORT_FIELDS)[number];

  @ApiPropertyOptional({ enum: PaymentStatus })
  @IsOptional()
  @IsEnum(PaymentStatus)
  status?: PaymentStatus;

  @ApiPropertyOptional({ enum: PaymentMethod })
  @IsOptional()
  @IsEnum(PaymentMethod)
  method?: PaymentMethod;

  @ApiPropertyOptional({ example: 'jazzcash', description: 'Filter by gateway name.' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  gateway?: string;

  @ApiPropertyOptional({ description: 'Staff view: filter by order.' })
  @IsOptional()
  @IsString()
  orderId?: string;

  @ApiPropertyOptional({ description: 'Staff view: filter by paying customer.' })
  @IsOptional()
  @IsString()
  userId?: string;

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

export const TRANSACTION_SORT_FIELDS = ['createdAt', 'amount', 'processedAt'] as const;

export class ListTransactionsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Matches the reference or description.' })
  declare search?: string;

  @ApiPropertyOptional({ enum: TRANSACTION_SORT_FIELDS, default: 'createdAt' })
  @IsOptional()
  @IsIn(TRANSACTION_SORT_FIELDS, {
    message: `sortBy must be one of: ${TRANSACTION_SORT_FIELDS.join(', ')}`,
  })
  declare sortBy?: (typeof TRANSACTION_SORT_FIELDS)[number];

  @ApiPropertyOptional({ enum: TransactionType })
  @IsOptional()
  @IsEnum(TransactionType)
  type?: TransactionType;

  @ApiPropertyOptional({ enum: TransactionStatus })
  @IsOptional()
  @IsEnum(TransactionStatus)
  status?: TransactionStatus;

  @ApiPropertyOptional({ description: 'Staff view: filter by order.' })
  @IsOptional()
  @IsString()
  orderId?: string;

  @ApiPropertyOptional({ description: 'Staff view: filter by customer.' })
  @IsOptional()
  @IsString()
  userId?: string;

  @ApiPropertyOptional({ description: 'Filter by payment attempt.' })
  @IsOptional()
  @IsString()
  paymentId?: string;

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

export class LedgerSummaryQueryDto {
  @ApiPropertyOptional({
    example: '2026-08-01T00:00:00.000Z',
    description: 'Defaults to the start of today.',
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate({ message: 'from must be a valid ISO 8601 date' })
  from?: Date;

  @ApiPropertyOptional({ example: '2026-08-31T23:59:59.999Z', description: 'Defaults to now.' })
  @IsOptional()
  @Type(() => Date)
  @IsDate({ message: 'to must be a valid ISO 8601 date' })
  to?: Date;
}

export class ListWebhookEventsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ example: 'jazzcash' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  gateway?: string;

  @ApiPropertyOptional({ enum: WebhookStatus })
  @IsOptional()
  @IsEnum(WebhookStatus)
  status?: WebhookStatus;

  @ApiPropertyOptional({ description: 'Filter to one payment attempt.' })
  @IsOptional()
  @IsString()
  paymentId?: string;

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

export class ListInvoicesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Matches the order number.', example: 'ZD-260810' })
  declare search?: string;

  @ApiPropertyOptional({ description: 'Staff view: filter by customer.' })
  @IsOptional()
  @IsString()
  userId?: string;

  @ApiPropertyOptional({ enum: PaymentStatus })
  @IsOptional()
  @IsEnum(PaymentStatus)
  paymentStatus?: PaymentStatus;

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
