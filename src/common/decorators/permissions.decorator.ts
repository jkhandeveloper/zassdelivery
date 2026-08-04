import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'permissions';

/**
 * Requires every listed `resource.action` permission.
 *
 * Unlike roles, this is checked with AND rather than OR: an endpoint that
 * declares two permissions genuinely needs both, and granting access on a
 * partial match would be a silent privilege escalation.
 */
export const RequirePermissions = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
