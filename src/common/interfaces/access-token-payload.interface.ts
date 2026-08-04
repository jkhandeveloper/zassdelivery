import type { UserRole } from '@prisma/client';

/** Claims carried by an access token. */
export interface AccessTokenPayload {
  /** Subject — the user id. */
  sub: string;
  phone: string;
  role: UserRole;
  permissions: string[];
  /** Session id, shared with the refresh-token family so logout can target it. */
  sid: string;
  /** Issued-at and expiry, populated by the signer. */
  iat?: number;
  exp?: number;
}

/** Claims carried by a refresh token. Deliberately thinner than the access token. */
export interface RefreshTokenPayload {
  sub: string;
  sid: string;
  /** Opaque secret matched against the stored SHA-256 hash. */
  jti: string;
  iat?: number;
  exp?: number;
}
