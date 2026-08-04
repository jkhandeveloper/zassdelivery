import type { RefreshToken } from '@prisma/client';

export interface CreateRefreshTokenInput {
  userId: string;
  tokenHash: string;
  familyId: string;
  expiresAt: Date;
  userAgent?: string;
  ipAddress?: string;
}

/** Persistence port for refresh-token sessions. */
export abstract class RefreshTokenRepository {
  abstract create(input: CreateRefreshTokenInput): Promise<RefreshToken>;

  /** Looks a token up by its SHA-256 hash; the raw token is never stored. */
  abstract findByHash(tokenHash: string): Promise<RefreshToken | null>;

  /** Marks a token as rotated and links it to its successor. */
  abstract rotate(id: string, replacedById: string): Promise<void>;

  abstract revoke(id: string, reason: string): Promise<void>;

  /**
   * Revokes every live token in a family. Used both for normal logout and for
   * the replay response, where the whole chain must be torn down.
   */
  abstract revokeFamily(familyId: string, reason: string): Promise<number>;

  /** Revokes every live session for a user — "sign out everywhere". */
  abstract revokeAllForUser(userId: string, reason: string): Promise<number>;

  /** Housekeeping: drops tokens that expired before `before`. */
  abstract deleteExpired(before: Date): Promise<number>;
}
