import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { AddressLabel } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

import { PK_PHONE_E164_REGEX } from '@/common/constants/app.constants';
import { normalisePhone } from '@/modules/auth/application/dto/auth.dto';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class CreateAddressDto {
  @ApiPropertyOptional({ enum: AddressLabel, default: AddressLabel.HOME })
  @IsOptional()
  @IsEnum(AddressLabel)
  label?: AddressLabel;

  @ApiProperty({ example: 'House 14, Street 3, Gulshan Colony', maxLength: 180 })
  @IsString()
  @MinLength(5)
  @MaxLength(180)
  @Transform(trim)
  line1!: string;

  @ApiPropertyOptional({ example: 'Flat 2B', maxLength: 180 })
  @IsOptional()
  @IsString()
  @MaxLength(180)
  @Transform(trim)
  line2?: string;

  @ApiPropertyOptional({
    description: 'Nearby reference point — how addresses are actually found locally.',
    example: 'Near Pabbi Bus Stand',
    maxLength: 180,
  })
  @IsOptional()
  @IsString()
  @MaxLength(180)
  @Transform(trim)
  landmark?: string;

  @ApiProperty({
    description: 'Latitude. The delivery zone is resolved from the coordinates automatically.',
    example: 34.0091,
  })
  @Type(() => Number)
  @IsLatitude({ message: 'latitude must be between -90 and 90' })
  latitude!: number;

  @ApiProperty({ example: 71.7869 })
  @Type(() => Number)
  @IsLongitude({ message: 'longitude must be between -180 and 180' })
  longitude!: number;

  @ApiPropertyOptional({
    description: 'Recipient, when delivering to someone other than the account holder.',
    example: 'Sana Bibi',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Transform(trim)
  recipientName?: string;

  @ApiPropertyOptional({ example: '+923007654321' })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => normalisePhone(value))
  @IsString()
  @Matches(PK_PHONE_E164_REGEX, {
    message: 'recipientPhone must be a valid Pakistani mobile number',
  })
  recipientPhone?: string;

  @ApiPropertyOptional({ example: 'Green gate, ring the bell twice.', maxLength: 280 })
  @IsOptional()
  @IsString()
  @MaxLength(280)
  @Transform(trim)
  deliveryNotes?: string;

  @ApiPropertyOptional({
    description: 'Make this the default delivery address. The first address always is.',
    default: false,
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => value === true || value === 'true')
  @IsBoolean()
  isDefault?: boolean;
}

/**
 * Every field optional. `PartialType` keeps the validation rules and Swagger
 * documentation in step with `CreateAddressDto` automatically.
 */
export class UpdateAddressDto extends PartialType(CreateAddressDto) {}
