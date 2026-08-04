import type { AuthUserRecord } from '../../domain/repositories/auth-user.repository';
import type { AuthResponseDto, AuthUserDto } from '../dto/auth-response.dto';
import type { IssuedTokens } from '../services/token.service';

/**
 * Projects a user row onto the public shape.
 *
 * Written as an explicit allow-list rather than a spread-and-delete: a column
 * added to the schema later must not leak to clients simply because nobody
 * remembered to exclude it.
 */
export function toAuthUserDto(user: AuthUserRecord): AuthUserDto {
  return {
    id: user.id,
    phone: user.phone,
    fullName: user.fullName,
    email: user.email,
    role: user.role,
    status: user.status,
    isPhoneVerified: user.phoneVerifiedAt !== null,
    permissions: user.permissions,
  };
}

export function toAuthResponse(user: AuthUserRecord, tokens: IssuedTokens): AuthResponseDto {
  return {
    user: toAuthUserDto(user),
    tokens: {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresIn: tokens.expiresIn,
      tokenType: 'Bearer',
    },
  };
}
