import type { UserRole } from '@prisma/client';

/**
 * The authenticated principal attached to every guarded request.
 *
 * Deliberately minimal: it carries what authorisation decisions need and
 * nothing else. Anything richer is a database read the handler should make
 * explicitly, so a stale token can never masquerade as fresh user state.
 */
export interface AuthenticatedUser {
  id: string;
  phone: string;
  role: UserRole;
  /** Flattened `resource.action` codes granted by every role the user holds. */
  permissions: string[];
  /** Set only for VENDOR_STAFF: the single restaurant this account works for. */
  staffRestaurantId: string | null;
  /** Session family, so a single device can be logged out on its own. */
  sessionId: string;
}

/** Express request augmented by `JwtAuthGuard`. */
export interface RequestWithUser {
  user?: AuthenticatedUser;
}
