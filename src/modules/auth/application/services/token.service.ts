import { createHash, randomBytes, randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

import { revokedSessionKey } from '@/common/guards/jwt-auth.guard';
import type {
  AccessTokenPayload,
  RefreshTokenPayload,
} from '@/common/interfaces/access-token-payload.interface';
import { jwtConfig } from '@/config';
import { RedisService } from '@/infrastructure/redis/redis.service';

import type { AuthUserRecord } from '../../domain/repositories/auth-user.repository';

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  /** Access-token lifetime in seconds, so clients know when to refresh. */
  expiresIn: number;
  sessionId: string;
  refreshTokenHash: string;
  refreshExpiresAt: Date;
}

/**
 * Mints, hashes and verifies tokens.
 *
 * Access tokens are signed JWTs carrying the caller's role and permissions.
 * Refresh tokens are JWTs too, but their `jti` is a high-entropy secret whose
 * SHA-256 hash is what the database stores — so a stolen database dump yields
 * no usable sessions.
 */
@Injectable()
export class TokenService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly redis: RedisService,
    @Inject(jwtConfig.KEY)
    private readonly config: ConfigType<typeof jwtConfig>,
  ) {}

  /**
   * Issues an access/refresh pair.
   *
   * `sessionId` is carried over when rotating so a refreshed session keeps its
   * identity; omit it to start a new one at login.
   */
  async issueTokens(user: AuthUserRecord, sessionId?: string): Promise<IssuedTokens> {
    const sid = sessionId ?? randomUUID();
    // 256 bits of entropy: the refresh token must not be guessable even if an
    // attacker knows the user id and session id.
    const jti = randomBytes(32).toString('hex');

    const accessPayload: AccessTokenPayload = {
      sub: user.id,
      phone: user.phone,
      role: user.role,
      permissions: user.permissions,
      staffRestaurantId: user.staffRestaurantId,
      sid,
    };

    const refreshPayload: RefreshTokenPayload = { sub: user.id, sid, jti };

    // Lifetimes are passed as seconds rather than as "15m" strings: jsonwebtoken
    // types the string form as a template literal that a plain `string` from
    // config cannot satisfy, and seconds are unambiguous anyway.
    const accessTtlSeconds = this.toSeconds(this.config.accessTtl);
    const refreshTtlSeconds = this.toSeconds(this.config.refreshTtl);

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(accessPayload, {
        secret: this.config.accessSecret,
        expiresIn: accessTtlSeconds,
        issuer: this.config.issuer,
        audience: this.config.audience,
      }),
      this.jwtService.signAsync(refreshPayload, {
        secret: this.config.refreshSecret,
        expiresIn: refreshTtlSeconds,
        issuer: this.config.issuer,
        audience: this.config.audience,
      }),
    ]);

    return {
      accessToken,
      refreshToken,
      expiresIn: accessTtlSeconds,
      sessionId: sid,
      refreshTokenHash: this.hashToken(jti),
      refreshExpiresAt: new Date(Date.now() + refreshTtlSeconds * 1000),
    };
  }

  /** Verifies a refresh token's signature and claims. Throws when invalid. */
  async verifyRefreshToken(token: string): Promise<RefreshTokenPayload> {
    return this.jwtService.verifyAsync<RefreshTokenPayload>(token, {
      secret: this.config.refreshSecret,
      issuer: this.config.issuer,
      audience: this.config.audience,
    });
  }

  /** SHA-256 of the token secret. Fast by design — the input is already random. */
  hashToken(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  /**
   * Denies further use of a session's access tokens.
   *
   * The entry only has to outlive the access token itself, so the TTL matches
   * the access-token lifetime and Redis reclaims it automatically.
   */
  async revokeSession(sessionId: string): Promise<void> {
    await this.redis.set(revokedSessionKey(sessionId), '1', this.toSeconds(this.config.accessTtl));
  }

  /** Converts a duration such as "15m" or "30d" into seconds. */
  private toSeconds(duration: string): number {
    const match = /^(\d+)(ms|s|m|h|d|w|y)$/.exec(duration);

    if (!match) {
      throw new Error(`Unsupported duration format: "${duration}"`);
    }

    const value = Number(match[1]);
    const multipliers: Record<string, number> = {
      ms: 0.001,
      s: 1,
      m: 60,
      h: 3600,
      d: 86400,
      w: 604800,
      y: 31536000,
    };

    return Math.floor(value * (multipliers[match[2] as string] ?? 1));
  }
}
