import { createParamDecorator, type ExecutionContext, UnauthorizedException } from '@nestjs/common';

import type {
  AuthenticatedUser,
  RequestWithUser,
} from '../interfaces/authenticated-user.interface';

/**
 * Injects the authenticated principal, or one of its fields:
 *
 * ```ts
 * findMine(@CurrentUser() user: AuthenticatedUser) {}
 * findMine(@CurrentUser('id') userId: string) {}
 * ```
 *
 * Throws rather than returning undefined on an unguarded route. A handler that
 * asks for the current user has already assumed one exists; failing loudly here
 * beats a downstream query silently running with `userId === undefined`.
 */
export const CurrentUser = createParamDecorator(
  (field: keyof AuthenticatedUser | undefined, context: ExecutionContext) => {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const user = request.user;

    if (!user) {
      throw new UnauthorizedException('No authenticated user on this request.');
    }

    return field ? user[field] : user;
  },
);
