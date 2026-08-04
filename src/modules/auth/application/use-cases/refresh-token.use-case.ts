import { Inject, Injectable, UnauthorizedException, type LoggerService } from '@nestjs/common';
import { UserStatus } from '@prisma/client';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';

import { AuthUserRepository } from '../../domain/repositories/auth-user.repository';
import { RefreshTokenRepository } from '../../domain/repositories/refresh-token.repository';
import type { AuthResponseDto } from '../dto/auth-response.dto';
import { TokenService } from '../services/token.service';
import { toAuthResponse } from './auth.mapper';

export interface RefreshContext {
  userAgent?: string;
  ipAddress?: string;
}

/**
 * Exchanges a refresh token for a new pair, rotating the old one.
 *
 * Rotation with replay detection: every refresh invalidates the token it was
 * issued against. If an already-rotated token is presented again, the only
 * plausible explanation is that it was captured — so the entire family is
 * revoked, logging out both the attacker and the legitimate user, who then
 * signs in again with credentials the attacker does not have.
 */
@Injectable()
export class RefreshTokenUseCase {
  private readonly context = RefreshTokenUseCase.name;

  constructor(
    private readonly users: AuthUserRepository,
    private readonly refreshTokens: RefreshTokenRepository,
    private readonly tokens: TokenService,
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: LoggerService,
  ) {}

  async execute(refreshToken: string, context: RefreshContext = {}): Promise<AuthResponseDto> {
    const invalid = new UnauthorizedException('Refresh token is invalid or has expired.');

    let payload;
    try {
      payload = await this.tokens.verifyRefreshToken(refreshToken);
    } catch {
      throw invalid;
    }

    const stored = await this.refreshTokens.findByHash(this.tokens.hashToken(payload.jti));

    if (!stored) {
      throw invalid;
    }

    // Already rotated or explicitly revoked, yet presented again.
    if (stored.revokedAt !== null) {
      this.logger.warn?.(
        `Refresh token replay detected for user ${stored.userId}; revoking family ${stored.familyId}`,
        this.context,
      );
      await this.refreshTokens.revokeFamily(stored.familyId, 'replay_detected');
      await this.tokens.revokeSession(stored.familyId);
      throw invalid;
    }

    if (stored.expiresAt.getTime() <= Date.now()) {
      throw invalid;
    }

    const user = await this.users.findById(stored.userId);

    if (!user || user.deletedAt !== null) {
      await this.refreshTokens.revokeFamily(stored.familyId, 'user_unavailable');
      throw invalid;
    }

    if (user.status === UserStatus.SUSPENDED || user.status === UserStatus.BANNED) {
      await this.refreshTokens.revokeFamily(stored.familyId, 'account_suspended');
      throw new UnauthorizedException('This account has been suspended.');
    }

    // Keep the session id so the new access token belongs to the same session,
    // and re-read permissions so a role change takes effect on refresh.
    const issued = await this.tokens.issueTokens(user, stored.familyId);

    const replacement = await this.refreshTokens.create({
      userId: user.id,
      tokenHash: issued.refreshTokenHash,
      familyId: stored.familyId,
      expiresAt: issued.refreshExpiresAt,
      userAgent: context.userAgent,
      ipAddress: context.ipAddress,
    });

    await this.refreshTokens.rotate(stored.id, replacement.id);

    return toAuthResponse(user, issued);
  }
}
