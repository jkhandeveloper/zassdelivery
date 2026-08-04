import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UserRole, UserStatus } from '@prisma/client';

/** The authenticated user as returned to clients. Never includes the hash. */
export class AuthUserDto {
  @ApiProperty({ example: 'clx8f2k9a0000zo79b1h2c3d4' })
  id!: string;

  @ApiProperty({ example: '+923001234567' })
  phone!: string;

  @ApiProperty({ example: 'Ahmad Khan' })
  fullName!: string;

  @ApiPropertyOptional({ example: 'ahmad@example.com', nullable: true })
  email!: string | null;

  @ApiProperty({ enum: UserRole, example: UserRole.CUSTOMER })
  role!: UserRole;

  @ApiProperty({ enum: UserStatus, example: UserStatus.ACTIVE })
  status!: UserStatus;

  @ApiProperty({ example: false, description: 'Whether the phone number is verified.' })
  isPhoneVerified!: boolean;

  @ApiProperty({
    type: [String],
    example: ['orders.read', 'orders.create'],
    description: 'Flattened resource.action codes granted to this user.',
  })
  permissions!: string[];
}

export class AuthTokensDto {
  @ApiProperty({ description: 'Short-lived bearer token for the Authorization header.' })
  accessToken!: string;

  @ApiProperty({ description: 'Long-lived token used to obtain a new access token.' })
  refreshToken!: string;

  @ApiProperty({ example: 900, description: 'Access-token lifetime in seconds.' })
  expiresIn!: number;

  @ApiProperty({ example: 'Bearer' })
  tokenType!: string;
}

export class AuthResponseDto {
  @ApiProperty({ type: AuthUserDto })
  user!: AuthUserDto;

  @ApiProperty({ type: AuthTokensDto })
  tokens!: AuthTokensDto;
}

export class MessageResponseDto {
  @ApiProperty({ example: 'Signed out successfully.' })
  message!: string;
}
