import type { Prisma, User, UserRole, UserStatus } from '@prisma/client';

import type { PaginatedResult } from '@/common/interfaces/paginated-result.interface';

export interface ListUsersFilter {
  page: number;
  limit: number;
  orderBy: Prisma.UserOrderByWithRelationInput;
  search?: string;
  role?: UserRole;
  status?: UserStatus;
  /** Include soft-deleted rows. Administrative views only. */
  includeDeleted?: boolean;
  createdFrom?: Date;
  createdTo?: Date;
}

export interface CreateUserInput {
  phone: string;
  fullName: string;
  role: UserRole;
  email?: string | null;
  passwordHash?: string | null;
  status?: UserStatus;
  /** VENDOR_STAFF only: the restaurant this account works for. */
  staffRestaurantId?: string | null;
}

export interface UpdateUserInput {
  fullName?: string;
  email?: string | null;
  avatarUrl?: string | null;
  locale?: string;
  pushToken?: string | null;
  role?: UserRole;
  status?: UserStatus;
}

export abstract class UserRepository {
  abstract findMany(filter: ListUsersFilter): Promise<PaginatedResult<User>>;
  abstract findById(id: string, includeDeleted?: boolean): Promise<User | null>;
  abstract findByPhone(phone: string): Promise<User | null>;
  abstract existsByPhone(phone: string, excludeUserId?: string): Promise<boolean>;
  abstract existsByEmail(email: string, excludeUserId?: string): Promise<boolean>;
  abstract create(input: CreateUserInput): Promise<User>;
  abstract update(id: string, input: UpdateUserInput): Promise<User>;
  /** Soft delete: sets `deletedAt` and revokes every session. */
  abstract softDelete(id: string): Promise<void>;
  abstract restore(id: string): Promise<User>;
  abstract countByRole(): Promise<Record<string, number>>;
  /** VENDOR_STAFF accounts registered against one restaurant. */
  abstract findStaffByRestaurant(restaurantId: string): Promise<User[]>;
}
