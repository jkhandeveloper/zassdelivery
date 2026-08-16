import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { User } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsEmail, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

import { PK_PHONE_E164_REGEX } from '@/common/constants/app.constants';
import { normalisePhone } from '@/modules/auth/application/dto/auth.dto';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/** Owner action: creates a VENDOR_STAFF account scoped to one restaurant. */
export class RegisterRestaurantStaffDto {
  @ApiProperty({ example: '+923001234567' })
  @Transform(({ value }: { value: unknown }) => normalisePhone(value))
  @IsString()
  @Matches(PK_PHONE_E164_REGEX, {
    message: 'phone must be a valid Pakistani mobile number, e.g. 03001234567',
  })
  phone!: string;

  @ApiProperty({ example: 'Kitchen Staff', minLength: 2, maxLength: 120 })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  @Transform(trim)
  fullName!: string;

  @ApiProperty({
    description: 'At least 8 characters, including one letter and one digit.',
    example: 'karahi2024',
    minLength: 8,
    maxLength: 128,
  })
  @IsString()
  @MinLength(8, { message: 'password must be at least 8 characters long' })
  @MaxLength(128)
  @Matches(/^(?=.*[A-Za-z])(?=.*\d).+$/, {
    message: 'password must contain at least one letter and one number',
  })
  password!: string;

  @ApiPropertyOptional({ example: 'staff@restaurant.pk' })
  @IsOptional()
  @IsEmail({}, { message: 'email must be a valid address' })
  @MaxLength(160)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  email?: string;
}

export class RestaurantStaffDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ example: '+923001234567' })
  phone!: string;

  @ApiProperty({ example: 'Ahmad Khan' })
  fullName!: string;

  @ApiPropertyOptional({ nullable: true })
  email!: string | null;

  @ApiProperty()
  createdAt!: Date;
}

export function toRestaurantStaffDto(user: User): RestaurantStaffDto {
  return {
    id: user.id,
    phone: user.phone,
    fullName: user.fullName,
    email: user.email,
    createdAt: user.createdAt,
  };
}
