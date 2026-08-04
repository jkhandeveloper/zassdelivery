import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';

import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import type { RequestWithUser } from '../interfaces/authenticated-user.interface';

/**
 * Enforces `@RequirePermissions(...)`. Every listed permission is required.
 *
 * Permissions travel in the access token, so this check costs nothing at
 * request time. The trade-off is that a permission change only takes effect
 * when the token is refreshed — bounded by the access-token TTL (15 minutes by
 * default), and immediate if the session is signed out.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!required || required.length === 0) {
      return true;
    }

    const { user } = context.switchToHttp().getRequest<RequestWithUser>();

    if (!user) {
      throw new UnauthorizedException('Authentication is required for this route.');
    }

    // A super admin holds every capability by definition; enumerating them all
    // into the token would only bloat every request.
    if (user.role === UserRole.SUPER_ADMIN) {
      return true;
    }

    const missing = required.filter((permission) => !user.permissions.includes(permission));

    if (missing.length > 0) {
      throw new ForbiddenException(`Missing required permission(s): ${missing.join(', ')}.`);
    }

    return true;
  }
}
