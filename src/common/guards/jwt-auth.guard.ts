import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { ConfigType } from '@nestjs/config';
import type { Request } from 'express';

import { jwtConfig } from '@/config';
import { RedisService } from '@/infrastructure/redis/redis.service';

import { RequestContext } from '../context/request-context';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import type { AccessTokenPayload } from '../interfaces/access-token-payload.interface';
import type {
  AuthenticatedUser,
  RequestWithUser,
} from '../interfaces/authenticated-user.interface';

/**
 * Verifies the bearer access token and attaches the principal to the request.
 *
 * Registered globally, so every route is protected unless it opts out with
 * `@Public()`. Access tokens are self-contained and short-lived; the only
 * server-side state consulted is a Redis deny-list, which is what makes logout
 * take effect immediately instead of at the next token expiry.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwtService: JwtService,
    private readonly redis: RedisService,
    @Inject(jwtConfig.KEY)
    private readonly config: ConfigType<typeof jwtConfig>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic === true) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request & RequestWithUser>();
    const token = this.extractBearerToken(request);

    if (!token) {
      throw new UnauthorizedException('Authentication token is missing.');
    }

    let payload: AccessTokenPayload;
    try {
      payload = await this.jwtService.verifyAsync<AccessTokenPayload>(token, {
        secret: this.config.accessSecret,
        issuer: this.config.issuer,
        audience: this.config.audience,
      });
    } catch {
      // Never echo the underlying jwt error: "expired" versus "malformed"
      // versus "bad signature" is useful information to an attacker.
      throw new UnauthorizedException('Authentication token is invalid or has expired.');
    }

    if (await this.isRevoked(payload.sid)) {
      throw new UnauthorizedException('This session has been signed out.');
    }

    const user: AuthenticatedUser = {
      id: payload.sub,
      phone: payload.phone,
      role: payload.role,
      permissions: payload.permissions,
      staffRestaurantId: payload.staffRestaurantId ?? null,
      sessionId: payload.sid,
    };

    request.user = user;
    // Makes every log line for this request attributable to the caller.
    RequestContext.patch({ userId: user.id, role: user.role });

    return true;
  }

  private extractBearerToken(request: Request): string | undefined {
    const header = request.headers.authorization;
    if (!header) {
      return undefined;
    }

    const [scheme, value] = header.split(' ');
    return scheme?.toLowerCase() === 'bearer' && value ? value : undefined;
  }

  private async isRevoked(sessionId: string): Promise<boolean> {
    return this.redis.exists(revokedSessionKey(sessionId));
  }
}

/** Redis key marking a signed-out session. */
export function revokedSessionKey(sessionId: string): string {
  return `auth:revoked-session:${sessionId}`;
}
