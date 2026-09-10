import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { Prisma } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

import { IsAbsoluteUrl } from '@/common/validators/is-absolute-url.decorator';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Where a scan-to-pay QR sends the money.
 *
 * Shared by restaurants and riders, because both hold the same kind of thing:
 * a picture of a wallet or bank QR, and the account it pays into. BANK covers
 * Raast and bank-app QRs; OTHER is SadaPay, NayaPay and whatever comes next,
 * named by its label.
 */
export const PAYMENT_QR_PROVIDERS = ['JAZZCASH', 'EASYPAISA', 'BANK', 'OTHER'] as const;

export type PaymentQrProvider = (typeof PAYMENT_QR_PROVIDERS)[number];

/** How each provider is named in ledger descriptions and messages. */
export const PAYMENT_QR_PROVIDER_NAMES: Record<PaymentQrProvider, string> = {
  JAZZCASH: 'JazzCash',
  EASYPAISA: 'Easypaisa',
  BANK: 'bank transfer',
  OTHER: 'mobile wallet',
};

/** A wallet, a bank app and a spare. A longer list is a wall of codes nobody scans. */
export const MAX_PAYMENT_QR_CODES = 6;

export class PaymentQrCodeInputDto {
  @ApiProperty({ enum: PAYMENT_QR_PROVIDERS, example: 'JAZZCASH' })
  @IsIn(PAYMENT_QR_PROVIDERS, {
    message: `provider must be one of: ${PAYMENT_QR_PROVIDERS.join(', ')}`,
  })
  provider!: PaymentQrProvider;

  @ApiPropertyOptional({
    example: 'Meezan Bank',
    description: 'Which bank or app — worth setting for BANK and OTHER.',
    maxLength: 60,
  })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  @Transform(trim)
  label?: string;

  @ApiProperty({
    example: 'Chapli Kabab House',
    description: 'The name the customer sees in their app before confirming the transfer.',
    maxLength: 120,
  })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  @Transform(trim)
  accountTitle!: string;

  @ApiPropertyOptional({
    example: '03001234567',
    description: 'For a customer whose camera will not read the code.',
    maxLength: 40,
  })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  @Transform(trim)
  accountNumber?: string;

  @ApiProperty({
    example: 'https://api.zassdelivery.pk/api/v1/uploads/payment-qr-codes/9f1c….png',
    description: 'The uploaded QR image, from `POST /uploads` with folder=payment-qr-codes.',
    maxLength: 500,
  })
  @IsAbsoluteUrl({ message: 'imageUrl must be an absolute URL' })
  @MaxLength(500)
  imageUrl!: string;
}

export class SetPaymentQrCodesDto {
  @ApiProperty({
    type: [PaymentQrCodeInputDto],
    description:
      'The complete list, in the order customers should see it. A replacement rather ' +
      'than a patch, so a removed code cannot linger — an empty list turns scan-to-pay off.',
  })
  @IsArray()
  @ArrayMaxSize(MAX_PAYMENT_QR_CODES, {
    message: `at most ${MAX_PAYMENT_QR_CODES} QR codes can be listed`,
  })
  @ValidateNested({ each: true })
  @Type(() => PaymentQrCodeInputDto)
  codes!: PaymentQrCodeInputDto[];
}

export class PaymentQrCodeDto {
  @ApiProperty({ enum: PAYMENT_QR_PROVIDERS }) provider!: PaymentQrProvider;
  @ApiPropertyOptional({ nullable: true, example: 'Meezan Bank' }) label!: string | null;
  @ApiProperty({ example: 'Chapli Kabab House' }) accountTitle!: string;
  @ApiPropertyOptional({ nullable: true, example: '03001234567' }) accountNumber!: string | null;
  @ApiProperty() imageUrl!: string;
}

function nonEmpty(value: string | undefined): string | null {
  return value === undefined || value === '' ? null : value;
}

/** The validated list, in the shape it is stored in. */
export function toStoredPaymentQrCodes(codes: PaymentQrCodeInputDto[]): Prisma.InputJsonArray {
  return codes.map((code) => ({
    provider: code.provider,
    label: nonEmpty(code.label),
    accountTitle: code.accountTitle,
    accountNumber: nonEmpty(code.accountNumber),
    imageUrl: code.imageUrl,
  }));
}

/**
 * Reads the stored list back.
 *
 * Defensive rather than a cast: the column is JSON, so nothing but this code
 * vouches for its shape, and a malformed entry is dropped rather than handed to
 * a customer as a QR that pays nobody.
 */
export function toPaymentQrCodes(value: Prisma.JsonValue | null | undefined): PaymentQrCodeDto[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      return [];
    }

    const { provider, label, accountTitle, accountNumber, imageUrl } = entry;

    if (
      typeof provider !== 'string' ||
      !(PAYMENT_QR_PROVIDERS as readonly string[]).includes(provider) ||
      typeof accountTitle !== 'string' ||
      typeof imageUrl !== 'string'
    ) {
      return [];
    }

    return [
      {
        provider: provider as PaymentQrProvider,
        label: typeof label === 'string' ? label : null,
        accountTitle,
        accountNumber: typeof accountNumber === 'string' ? accountNumber : null,
        imageUrl,
      },
    ];
  });
}
