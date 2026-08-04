import { Injectable, UnauthorizedException } from '@nestjs/common';

import { BusinessRuleViolationException } from '@/common/exceptions/domain.exception';

import { AuthUserRepository } from '../../domain/repositories/auth-user.repository';
import { RefreshTokenRepository } from '../../domain/repositories/refresh-token.repository';
import type { ChangePasswordDto } from '../dto/auth.dto';
import { PasswordService } from '../services/password.service';

@Injectable()
export class ChangePasswordUseCase {
  constructor(
    private readonly users: AuthUserRepository,
    private readonly refreshTokens: RefreshTokenRepository,
    private readonly passwords: PasswordService,
  ) {}

  async execute(userId: string, dto: ChangePasswordDto): Promise<{ message: string }> {
    const user = await this.users.findById(userId);

    if (!user || !user.passwordHash) {
      throw new UnauthorizedException('Password cannot be changed for this account.');
    }

    // Re-checking the current password is what stops a hijacked access token
    // from locking the real owner out of their own account.
    const matches = await this.passwords.verify(user.passwordHash, dto.currentPassword);

    if (!matches) {
      throw new UnauthorizedException('The current password is incorrect.');
    }

    if (dto.currentPassword === dto.newPassword) {
      throw new BusinessRuleViolationException(
        'The new password must be different from the current one.',
      );
    }

    await this.users.updatePassword(userId, await this.passwords.hash(dto.newPassword));

    // A password change is the standard response to a suspected compromise, so
    // every other session is torn down. The current one is kept alive so the
    // user is not bounced out of the app they just used.
    const revoked = await this.refreshTokens.revokeAllForUser(userId, 'password_changed');

    return {
      message:
        revoked > 0
          ? 'Password changed. You have been signed out on all other devices.'
          : 'Password changed successfully.',
    };
  }
}
