import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SubscriptionInvoiceStatus, SubscriptionStatus } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsDate,
  IsEnum,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

import { PAYMENT_QR_PROVIDERS, type PaymentQrProvider } from '@/common/dto/payment-qr-code.dto';
import { PaginationQueryDto } from '@/common/dto/pagination-query.dto';
import { IsAbsoluteUrl } from '@/common/validators/is-absolute-url.decorator';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class SubmitTransferDto {
  @ApiProperty({
    enum: PAYMENT_QR_PROVIDERS,
    example: 'EASYPAISA',
    description: 'Which app or bank the fee was transferred through.',
  })
  @IsIn(PAYMENT_QR_PROVIDERS, {
    message: `channel must be one of: ${PAYMENT_QR_PROVIDERS.join(', ')}`,
  })
  channel!: PaymentQrProvider;

  @ApiPropertyOptional({
    example: '012345678901',
    description:
      'The transaction ID your JazzCash, Easypaisa or bank app shows for the ' +
      'transfer. One TID can settle one invoice only.',
    maxLength: 120,
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Transform(trim)
  reference?: string;

  @ApiPropertyOptional({
    example: 'https://api.zassdelivery.pk/api/v1/uploads/billing-proofs/9f1c….png',
    description:
      'A screenshot of the transfer, from `POST /uploads`. Not required, but it ' +
      'is what turns a rejected payment into a two-minute conversation.',
    maxLength: 500,
  })
  @IsOptional()
  @IsAbsoluteUrl({ message: 'proofImageUrl must be an absolute URL' })
  @MaxLength(500)
  proofImageUrl?: string;
}

export class RejectTransferDto {
  @ApiProperty({
    example: 'No transfer with that TID reached our Easypaisa account on 12 September.',
    description:
      'Shown to the vendor as-is. The invoice goes back to unpaid, so this has ' +
      'to say what they should do next.',
    maxLength: 500,
  })
  @IsString()
  @MinLength(10, { message: 'Give the vendor a reason they can act on.' })
  @MaxLength(500)
  @Transform(trim)
  reason!: string;
}

export class VoidInvoiceDto {
  @ApiProperty({
    example: 'Waived — platform outage for most of the period.',
    description: 'Why this month is not being collected. Recorded against the invoice.',
    maxLength: 500,
  })
  @IsString()
  @MinLength(10)
  @MaxLength(500)
  @Transform(trim)
  reason!: string;
}

export class RecordPaymentDto {
  @ApiProperty({
    enum: PAYMENT_QR_PROVIDERS,
    example: 'EASYPAISA',
    description: 'How the money reached us.',
  })
  @IsIn(PAYMENT_QR_PROVIDERS, {
    message: `channel must be one of: ${PAYMENT_QR_PROVIDERS.join(', ')}`,
  })
  channel!: PaymentQrProvider;

  @ApiPropertyOptional({
    example: '012345678901',
    description: 'The transaction ID on the transfer. One TID settles one invoice.',
    maxLength: 120,
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Transform(trim)
  reference?: string;

  @ApiPropertyOptional({
    description:
      'When the money actually arrived. Defaults to now — set it when you are ' +
      'entering a transfer that landed days ago, so the vendor’s history reads true.',
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  paidAt?: Date;
}

/** Corrects the details of a payment already recorded. */
export class UpdatePaymentRecordDto {
  @ApiPropertyOptional({ enum: PAYMENT_QR_PROVIDERS })
  @IsOptional()
  @IsIn(PAYMENT_QR_PROVIDERS, {
    message: `channel must be one of: ${PAYMENT_QR_PROVIDERS.join(', ')}`,
  })
  channel?: PaymentQrProvider;

  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Transform(trim)
  reference?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  paidAt?: Date;
}

export class SetDefaultFeeDto {
  @ApiProperty({
    example: 2500,
    description:
      'The standard monthly fee, in PKR. Applies to every vendor who is not on ' +
      'a negotiated rate, and re-prices their current unpaid invoice.',
    minimum: 0,
  })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'monthlyFee must be an amount' })
  @Min(0, { message: 'monthlyFee cannot be negative' })
  monthlyFee!: number;
}

export class SuspendVendorDto {
  @ApiProperty({
    example: 'Closed pending a food-safety review. Call the office to discuss.',
    description:
      'Why the account is being closed. Shown to the vendor on their own ' +
      'screens, so it has to say what it is and who to talk to.',
    maxLength: 500,
  })
  @IsString()
  @MinLength(10, { message: 'Give the vendor a reason they can act on.' })
  @MaxLength(500)
  @Transform(trim)
  reason!: string;
}

export class SetMonthlyFeeDto {
  @ApiPropertyOptional({
    example: 1500,
    nullable: true,
    description:
      "This vendor's negotiated monthly fee, in PKR. Null puts them back on the " +
      'platform default, so a later price change reaches them with everyone else.',
    minimum: 0,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'monthlyFee must be an amount' })
  @Min(0, { message: 'monthlyFee cannot be negative' })
  monthlyFee!: number | null;
}

export class ListSubscriptionsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: SubscriptionStatus })
  @IsOptional()
  @IsEnum(SubscriptionStatus)
  status?: SubscriptionStatus;
}

export class ListInvoicesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: SubscriptionInvoiceStatus })
  @IsOptional()
  @IsEnum(SubscriptionInvoiceStatus)
  status?: SubscriptionInvoiceStatus;

  @ApiPropertyOptional({ description: 'Only invoices for this listing.' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  restaurantId?: string;

  @ApiPropertyOptional({ description: 'Issued on or after this date.' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  from?: Date;

  @ApiPropertyOptional({ description: 'Issued on or before this date.' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  to?: Date;
}
