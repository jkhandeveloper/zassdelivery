import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

import { PK_PHONE_E164_REGEX } from '@/common/constants/app.constants';

/**
 * Normalises the many ways a Pakistani mobile number is written into E.164.
 *
 * Customers type "0300 1234567", "0300-1234567" or "+92 300 1234567"
 * interchangeably. Rejecting anything but one canonical form would be hostile;
 * normalising here means the unique constraint on `users.phone` sees a single
 * representation and the same person can never register twice.
 */
export function normalisePhone(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }

  const digits = value.replace(/[\s()-]/g, '');

  if (digits.startsWith('+92')) {
    return digits;
  }
  if (digits.startsWith('92')) {
    return `+${digits}`;
  }
  if (digits.startsWith('03')) {
    return `+92${digits.slice(1)}`;
  }
  if (digits.startsWith('3')) {
    return `+92${digits}`;
  }

  return digits;
}

const PHONE_DOC = {
  description:
    'Pakistani mobile number. Accepted as 03XXXXXXXXX, 92XXXXXXXXXX or ' +
    '+923XXXXXXXXX; stored in E.164.',
  example: '+923001234567',
};

export class RegisterDto {
  @ApiProperty(PHONE_DOC)
  @Transform(({ value }: { value: unknown }) => normalisePhone(value))
  @IsString()
  @Matches(PK_PHONE_E164_REGEX, {
    message: 'phone must be a valid Pakistani mobile number, e.g. 03001234567',
  })
  phone!: string;

  @ApiProperty({ example: 'Ahmad Khan', minLength: 2, maxLength: 120 })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  fullName!: string;

  @ApiProperty({
    description:
      'At least 8 characters, including one letter and one digit. ' +
      'Length is weighted over exotic character classes, which mostly drive ' +
      'users toward predictable substitutions.',
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

  @ApiPropertyOptional({ example: 'ahmad@example.com' })
  @IsOptional()
  @IsEmail({}, { message: 'email must be a valid address' })
  @MaxLength(160)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  email?: string;

  @ApiPropertyOptional({
    description:
      'Self-service registration is limited to CUSTOMER, RIDER and ' +
      'VENDOR_OWNER. A vendor registering here still needs a restaurant ' +
      'approved by a super admin (POST /restaurant-management, then ' +
      'POST /restaurant-management/:id/approve) before it goes live. ' +
      'VENDOR_STAFF accounts are created by the vendor owner, not through ' +
      'registration.',
    enum: [UserRole.CUSTOMER, UserRole.RIDER, UserRole.VENDOR_OWNER],
    default: UserRole.CUSTOMER,
  })
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;
}

export class LoginDto {
  @ApiProperty(PHONE_DOC)
  @Transform(({ value }: { value: unknown }) => normalisePhone(value))
  @IsString()
  @Matches(PK_PHONE_E164_REGEX, {
    message: 'phone must be a valid Pakistani mobile number, e.g. 03001234567',
  })
  phone!: string;

  @ApiProperty({ example: 'karahi2024' })
  @IsString()
  @MaxLength(128)
  password!: string;
}

export class RefreshTokenDto {
  @ApiProperty({ description: 'The refresh token issued by login or a previous refresh.' })
  @IsString()
  refreshToken!: string;
}

export class LogoutDto {
  @ApiPropertyOptional({
    description:
      'Refresh token for the session being ended. Omit to sign out only the ' +
      'current access token.',
  })
  @IsOptional()
  @IsString()
  refreshToken?: string;

  @ApiPropertyOptional({
    description: 'Sign out every session on every device.',
    default: false,
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => value === true || value === 'true')
  @IsBoolean()
  allDevices?: boolean;
}

export class ChangePasswordDto {
  @ApiProperty({ example: 'karahi2024' })
  @IsString()
  @MaxLength(128)
  currentPassword!: string;

  @ApiProperty({ example: 'chapli2025', minLength: 8, maxLength: 128 })
  @IsString()
  @MinLength(8, { message: 'newPassword must be at least 8 characters long' })
  @MaxLength(128)
  @Matches(/^(?=.*[A-Za-z])(?=.*\d).+$/, {
    message: 'newPassword must contain at least one letter and one number',
  })
  newPassword!: string;
}
