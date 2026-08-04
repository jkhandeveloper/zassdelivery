import type { User, UserRole } from '@prisma/client';

/** Everything the Auth module needs to know about a user account. */
export interface AuthUserRecord extends User {
  permissions: string[];
}

export interface CreateAuthUserInput {
  phone: string;
  fullName: string;
  passwordHash: string;
  email?: string;
  role: UserRole;
}

/**
 * The port through which the Auth module reads and writes accounts.
 *
 * Declared here in the domain layer and implemented over Prisma in
 * `infrastructure/`, so use-cases can be exercised against an in-memory fake
 * without a database.
 */
export abstract class AuthUserRepository {
  abstract findByPhone(phone: string): Promise<AuthUserRecord | null>;
  abstract findById(id: string): Promise<AuthUserRecord | null>;
  abstract existsByPhone(phone: string): Promise<boolean>;
  abstract existsByEmail(email: string): Promise<boolean>;
  abstract create(input: CreateAuthUserInput): Promise<AuthUserRecord>;
  abstract updatePassword(userId: string, passwordHash: string): Promise<void>;
  abstract recordLogin(userId: string): Promise<void>;
}
