import { Injectable } from '@nestjs/common';

import { RefreshTokenRepository } from '../../domain/repositories/refresh-token.repository';
import type { LogoutDto } from '../dto/auth.dto';
import { TokenService } from '../services/token.service';

@Injectable()
export class LogoutUseCase {
  constructor(
    private readonly refreshTokens: RefreshTokenRepository,
    private readonly tokens: TokenService,
  ) {}

  /**
   * Ends the caller's session.
   *
   * Two things have to happen for logout to be real: the refresh token must be
   * revoked in the database so no new access tokens can be minted, and the
   * session must be denied in Redis so the access token already in the client's
   * hands stops working immediately rather than at its next expiry.
   */
  async execute(userId: string, sessionId: string, dto: LogoutDto): Promise<{ message: string }> {
    if (dto.allDevices === true) {
      const revoked = await this.refreshTokens.revokeAllForUser(userId, 'logout_all_devices');
      await this.tokens.revokeSession(sessionId);

      return {
        message: `Signed out of ${revoked} session${revoked === 1 ? '' : 's'} on all devices.`,
      };
    }

    if (dto.refreshToken) {
      try {
        const payload = await this.tokens.verifyRefreshToken(dto.refreshToken);
        const stored = await this.refreshTokens.findByHash(this.tokens.hashToken(payload.jti));

        // Only the owner of a token may revoke it; otherwise a stolen token
        // could be used to sign other people out.
        if (stored && stored.userId === userId) {
          await this.refreshTokens.revokeFamily(stored.familyId, 'logout');
        }
      } catch {
        // An unparseable or expired refresh token is not a reason to fail a
        // logout — the caller wants to be signed out either way.
      }
    } else {
      await this.refreshTokens.revokeFamily(sessionId, 'logout');
    }

    await this.tokens.revokeSession(sessionId);

    return { message: 'Signed out successfully.' };
  }
}
