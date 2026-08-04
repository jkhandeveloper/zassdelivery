import { SetMetadata } from '@nestjs/common';
import type { UserRole } from '@prisma/client';

export const ROLES_KEY = 'roles';

/**
 * Restricts a route to the listed roles. The caller needs any one of them.
 *
 * Use this for coarse "which kind of actor is this" checks; use
 * `@RequirePermissions` when the answer depends on a specific capability.
 */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
