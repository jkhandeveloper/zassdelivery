import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UserRole } from '@prisma/client';
import type { ConfigType } from '@nestjs/config';
import type { Socket } from 'socket.io';

import { revokedSessionKey } from '@/common/guards/jwt-auth.guard';
import type { AccessTokenPayload } from '@/common/interfaces/access-token-payload.interface';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import { jwtConfig } from '@/config';
import { RedisService } from '@/infrastructure/redis/redis.service';

/** What a socket carries once it has proved who it is. */
export interface SocketPrincipal {
  user: AuthenticatedUser;
  /** The rider profile behind this account, resolved lazily on first use. */
  driverId: string | null;
}

/**
 * Authenticates a socket handshake.
 *
 * The same access token as the HTTP API, checked the same way — including the
 * Redis deny-list, so signing out closes the socket rather than leaving a live
 * channel to a revoked session. A websocket that outlives its own logout is a
 * subtle and very long-lived hole.
 *
 * Tokens are accepted from `auth.token`, the `Authorization` header or a query
 * parameter, because the three Socket.IO client families disagree about which
 * is available: browsers cannot set headers on the initial upgrade, and some
 * mobile clients cannot set the auth payload.
 */
@Injectable()
export class SocketAuthenticator {
  constructor(
    private readonly jwtService: JwtService,
    private readonly redis: RedisService,
    @Inject(jwtConfig.KEY)
    private readonly config: ConfigType<typeof jwtConfig>,
  ) {}

  /**
   * Verifies the handshake and returns the principal.
   *
   * Throws with a message meant for a developer's console, never for an end
   * user — and never distinguishing "expired" from "bad signature", which is
   * information an attacker can use and a legitimate client cannot.
   */
  async authenticate(socket: Socket): Promise<AuthenticatedUser> {
    const token = this.extractToken(socket);

    if (token === null) {
      throw new Error('Authentication token is missing.');
    }

    let payload: AccessTokenPayload;

    try {
      payload = await this.jwtService.verifyAsync<AccessTokenPayload>(token, {
        secret: this.config.accessSecret,
        issuer: this.config.issuer,
        audience: this.config.audience,
      });
    } catch {
      throw new Error('Authentication token is invalid or has expired.');
    }

    if (await this.redis.exists(revokedSessionKey(payload.sid))) {
      throw new Error('This session has been signed out.');
    }

    return {
      id: payload.sub,
      phone: payload.phone,
      role: payload.role,
      permissions: payload.permissions,
      sessionId: payload.sid,
    };
  }

  static isStaff(user: AuthenticatedUser): boolean {
    return user.role === UserRole.ADMIN || user.role === UserRole.SUPER_ADMIN;
  }

  private extractToken(socket: Socket): string | null {
    const auth = socket.handshake.auth as { token?: unknown } | undefined;

    if (typeof auth?.token === 'string' && auth.token.trim() !== '') {
      return this.stripBearer(auth.token);
    }

    const header = socket.handshake.headers.authorization;

    if (typeof header === 'string' && header.trim() !== '') {
      return this.stripBearer(header);
    }

    const query = socket.handshake.query.token;

    if (typeof query === 'string' && query.trim() !== '') {
      return this.stripBearer(query);
    }

    return null;
  }

  private stripBearer(value: string): string {
    const trimmed = value.trim();

    return trimmed.toLowerCase().startsWith('bearer ') ? trimmed.slice(7).trim() : trimmed;
  }
}
