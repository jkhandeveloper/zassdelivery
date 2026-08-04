import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UserRole, UserStatus } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

import { PK_PHONE_E164_REGEX } from '@/common/constants/app.constants';
import { normalisePhone } from '@/modules/auth/application/dto/auth.dto';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/** Fields a user may change about themselves. Role and status are absent by design. */
export class UpdateProfileDto {
  @ApiPropertyOptional({ example: 'Ahmad Khan', minLength: 2, maxLength: 120 })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  @Transform(trim)
  fullName?: string;

  @ApiPropertyOptional({ example: 'ahmad@example.com' })
  @IsOptional()
  @IsEmail({}, { message: 'email must be a valid address' })
  @MaxLength(160)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  email?: string;

  @ApiPropertyOptional({ example: 'https://cdn.zassdelivery.pk/avatars/ahmad.jpg' })
  @IsOptional()
  @IsUrl({ require_protocol: true }, { message: 'avatarUrl must be a valid URL' })
  @MaxLength(500)
  avatarUrl?: string;

  @ApiPropertyOptional({ description: 'UI language.', enum: ['en', 'ur'], example: 'en' })
  @IsOptional()
  @IsIn(['en', 'ur'], { message: 'locale must be either "en" or "ur"' })
  locale?: string;

  @ApiPropertyOptional({
    description: 'Device token for push notifications. Send null to stop receiving them.',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  pushToken?: string | null;
}

/** Administrator-only creation. Any role may be assigned here. */
export class CreateUserDto {
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

  @ApiProperty({ enum: UserRole, example: UserRole.VENDOR_STAFF })
  @IsEnum(UserRole)
  role!: UserRole;

  @ApiPropertyOptional({ example: 'staff@restaurant.pk' })
  @IsOptional()
  @IsEmail()
  @MaxLength(160)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  email?: string;

  @ApiPropertyOptional({
    description:
      'Initial password. Omit to create an account that cannot sign in with a ' +
      'password until one is set.',
    minLength: 8,
    maxLength: 128,
  })
  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  @Matches(/^(?=.*[A-Za-z])(?=.*\d).+$/, {
    message: 'password must contain at least one letter and one number',
  })
  password?: string;

  @ApiPropertyOptional({ enum: UserStatus, default: UserStatus.ACTIVE })
  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;
}

/** Administrator-only update. Extends the self-service fields with role and status. */
export class AdminUpdateUserDto extends UpdateProfileDto {
  @ApiPropertyOptional({ enum: UserRole })
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  @ApiPropertyOptional({ enum: UserStatus })
  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;
}

export class ChangeUserStatusDto {
  @ApiProperty({ enum: UserStatus, example: UserStatus.SUSPENDED })
  @IsEnum(UserStatus)
  status!: UserStatus;

  @ApiPropertyOptional({
    description: 'Recorded on the audit trail and shown to support staff.',
    example: 'Repeated fraudulent chargebacks.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}
