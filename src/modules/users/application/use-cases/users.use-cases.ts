import { Injectable } from '@nestjs/common';
import { UserRole, UserStatus } from '@prisma/client';

import {
  BusinessRuleViolationException,
  ResourceConflictException,
  ResourceNotFoundException,
} from '@/common/exceptions/domain.exception';
import type { PaginatedResult } from '@/common/interfaces/paginated-result.interface';
import { buildOrderBy } from '@/common/utils/pagination.util';
import { PasswordService } from '@/modules/auth/application/services/password.service';
import { RefreshTokenRepository } from '@/modules/auth/domain/repositories/refresh-token.repository';

import { UserRepository } from '../../domain/repositories/user.repository';
import type { AdminUpdateUserDto, ChangeUserStatusDto, CreateUserDto } from '../dto/user.dto';
import { USER_SORT_FIELDS, type ListUsersQueryDto } from '../dto/user-query.dto';
import { toUserDto, type UserDto } from '../dto/user-response.dto';

@Injectable()
export class ListUsersUseCase {
  constructor(private readonly users: UserRepository) {}

  async execute(query: ListUsersQueryDto): Promise<PaginatedResult<UserDto>> {
    const orderBy = buildOrderBy(query.sortBy, query.sortOrder, USER_SORT_FIELDS, 'createdAt');

    const result = await this.users.findMany({
      page: query.page,
      limit: query.limit,
      orderBy,
      search: query.search,
      role: query.role,
      status: query.status,
      includeDeleted: query.includeDeleted,
      createdFrom: query.createdFrom,
      createdTo: query.createdTo,
    });

    return {
      items: result.items.map((user) => toUserDto(user, query.includeDeleted === true)),
      meta: result.meta,
    };
  }
}

@Injectable()
export class GetUserUseCase {
  constructor(private readonly users: UserRepository) {}

  async execute(id: string): Promise<UserDto> {
    const user = await this.users.findById(id, true);

    if (!user) {
      throw new ResourceNotFoundException('User', id);
    }

    return toUserDto(user, true);
  }
}

@Injectable()
export class CreateUserUseCase {
  constructor(
    private readonly users: UserRepository,
    private readonly passwords: PasswordService,
  ) {}

  async execute(dto: CreateUserDto): Promise<UserDto> {
    if (await this.users.existsByPhone(dto.phone)) {
      throw new ResourceConflictException('An account with this phone number already exists.');
    }

    if (dto.email && (await this.users.existsByEmail(dto.email))) {
      throw new ResourceConflictException('An account with this email address already exists.');
    }

    const user = await this.users.create({
      phone: dto.phone,
      fullName: dto.fullName,
      role: dto.role,
      email: dto.email ?? null,
      passwordHash: dto.password ? await this.passwords.hash(dto.password) : null,
      status: dto.status ?? UserStatus.ACTIVE,
      staffRestaurantId:
        dto.role === UserRole.VENDOR_STAFF ? (dto.staffRestaurantId ?? null) : null,
    });

    return toUserDto(user, true);
  }
}

@Injectable()
export class UpdateUserUseCase {
  constructor(
    private readonly users: UserRepository,
    private readonly refreshTokens: RefreshTokenRepository,
  ) {}

  async execute(id: string, dto: AdminUpdateUserDto, actorId: string): Promise<UserDto> {
    const existing = await this.users.findById(id);

    if (!existing) {
      throw new ResourceNotFoundException('User', id);
    }

    if (dto.email && (await this.users.existsByEmail(dto.email, id))) {
      throw new ResourceConflictException('An account with this email address already exists.');
    }

    // An administrator demoting themselves mid-session would lock the platform
    // out of its own back office if they were the last one holding the role.
    if (id === actorId && dto.role !== undefined && dto.role !== existing.role) {
      throw new BusinessRuleViolationException('You cannot change your own role.');
    }

    const user = await this.users.update(id, dto);

    // A role change rewrites the caller's permissions, and those are baked into
    // access tokens. Ending their sessions forces a fresh sign-in that picks
    // the new role up immediately rather than up to a token lifetime later.
    if (dto.role !== undefined && dto.role !== existing.role) {
      await this.refreshTokens.revokeAllForUser(id, 'role_changed');
    }

    return toUserDto(user, true);
  }
}

@Injectable()
export class ChangeUserStatusUseCase {
  constructor(
    private readonly users: UserRepository,
    private readonly refreshTokens: RefreshTokenRepository,
  ) {}

  async execute(id: string, dto: ChangeUserStatusDto, actorId: string): Promise<UserDto> {
    const existing = await this.users.findById(id);

    if (!existing) {
      throw new ResourceNotFoundException('User', id);
    }

    if (id === actorId) {
      throw new BusinessRuleViolationException('You cannot change your own account status.');
    }

    const user = await this.users.update(id, { status: dto.status });

    // Suspension has to take effect now, not whenever the current token expires.
    if (dto.status === UserStatus.SUSPENDED || dto.status === UserStatus.BANNED) {
      await this.refreshTokens.revokeAllForUser(id, `status_${dto.status.toLowerCase()}`);
    }

    return toUserDto(user, true);
  }
}

@Injectable()
export class DeleteUserUseCase {
  constructor(
    private readonly users: UserRepository,
    private readonly refreshTokens: RefreshTokenRepository,
  ) {}

  async execute(id: string, actorId: string): Promise<{ message: string }> {
    const existing = await this.users.findById(id);

    if (!existing) {
      throw new ResourceNotFoundException('User', id);
    }

    if (id === actorId) {
      throw new BusinessRuleViolationException('You cannot delete your own account.');
    }

    // The last super admin must not be removable, or the platform becomes
    // unadministrable with no way back in.
    if (existing.role === UserRole.SUPER_ADMIN) {
      const counts = await this.users.countByRole();
      if ((counts[UserRole.SUPER_ADMIN] ?? 0) <= 1) {
        throw new BusinessRuleViolationException(
          'The last remaining super admin cannot be deleted.',
        );
      }
    }

    // Soft delete: orders, payments and reviews reference this user and must
    // keep resolving. `deletedAt` hides the account from every read path.
    await this.users.softDelete(id);
    await this.refreshTokens.revokeAllForUser(id, 'account_deleted');

    return { message: 'Account deleted.' };
  }
}

@Injectable()
export class RestoreUserUseCase {
  constructor(private readonly users: UserRepository) {}

  async execute(id: string): Promise<UserDto> {
    const existing = await this.users.findById(id, true);

    if (!existing) {
      throw new ResourceNotFoundException('User', id);
    }

    if (existing.deletedAt === null) {
      throw new BusinessRuleViolationException('This account is not deleted.');
    }

    // The phone number may have been claimed by a new account in the meantime.
    if (await this.users.existsByPhone(existing.phone, id)) {
      throw new ResourceConflictException(
        'This phone number now belongs to another account, so this one cannot be restored.',
      );
    }

    return toUserDto(await this.users.restore(id), true);
  }
}
