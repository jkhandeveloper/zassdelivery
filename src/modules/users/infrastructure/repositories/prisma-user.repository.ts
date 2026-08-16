import { Injectable } from '@nestjs/common';
import { UserStatus, type Prisma, type User } from '@prisma/client';

import type { PaginatedResult } from '@/common/interfaces/paginated-result.interface';
import { paginate } from '@/common/utils/pagination.util';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';

import {
  UserRepository,
  type CreateUserInput,
  type ListUsersFilter,
  type UpdateUserInput,
} from '../../domain/repositories/user.repository';

@Injectable()
export class PrismaUserRepository extends UserRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async findMany(filter: ListUsersFilter): Promise<PaginatedResult<User>> {
    const where = this.buildWhere(filter);

    // count and page are issued together: two sequential round-trips would
    // double the latency of every listing for no benefit.
    const [total, items] = await this.prisma.$transaction([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        orderBy: filter.orderBy,
        skip: (filter.page - 1) * filter.limit,
        take: filter.limit,
      }),
    ]);

    return paginate(items, total, filter.page, filter.limit);
  }

  async findById(id: string, includeDeleted = false): Promise<User | null> {
    const user = await this.prisma.user.findUnique({ where: { id } });

    if (!user || (!includeDeleted && user.deletedAt !== null)) {
      return null;
    }

    return user;
  }

  async findByPhone(phone: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { phone } });
  }

  async existsByPhone(phone: string, excludeUserId?: string): Promise<boolean> {
    const found = await this.prisma.user.findFirst({
      where: { phone, ...(excludeUserId && { id: { not: excludeUserId } }) },
      select: { id: true },
    });

    return found !== null;
  }

  async existsByEmail(email: string, excludeUserId?: string): Promise<boolean> {
    const found = await this.prisma.user.findFirst({
      where: { email, ...(excludeUserId && { id: { not: excludeUserId } }) },
      select: { id: true },
    });

    return found !== null;
  }

  async create(input: CreateUserInput): Promise<User> {
    // The account, its role assignment and its wallet are created together, so
    // no user can exist without the wallet a refund would need.
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          phone: input.phone,
          fullName: input.fullName,
          role: input.role,
          email: input.email ?? null,
          passwordHash: input.passwordHash ?? null,
          status: input.status ?? UserStatus.ACTIVE,
          staffRestaurantId: input.staffRestaurantId ?? null,
        },
      });

      const role = await tx.role.findUnique({
        where: { slug: input.role.toLowerCase() },
        select: { id: true },
      });

      if (role) {
        await tx.userRoleAssignment.create({ data: { userId: user.id, roleId: role.id } });
      }

      await tx.wallet.create({ data: { userId: user.id } });

      return user;
    });
  }

  async update(id: string, input: UpdateUserInput): Promise<User> {
    // A role change must also move the role assignment row, or the user's
    // permissions would still be resolved from their previous role.
    if (input.role !== undefined) {
      return this.prisma.$transaction(async (tx) => {
        const updated = await tx.user.update({ where: { id }, data: input });

        await tx.userRoleAssignment.deleteMany({ where: { userId: id } });

        const role = await tx.role.findUnique({
          where: { slug: updated.role.toLowerCase() },
          select: { id: true },
        });

        if (role) {
          await tx.userRoleAssignment.create({ data: { userId: id, roleId: role.id } });
        }

        return updated;
      });
    }

    return this.prisma.user.update({ where: { id }, data: input });
  }

  async softDelete(id: string): Promise<void> {
    await this.prisma.user.update({
      where: { id },
      data: { deletedAt: new Date(), status: UserStatus.BANNED },
    });
  }

  async restore(id: string): Promise<User> {
    return this.prisma.user.update({
      where: { id },
      data: { deletedAt: null, status: UserStatus.ACTIVE },
    });
  }

  async findStaffByRestaurant(restaurantId: string): Promise<User[]> {
    return this.prisma.user.findMany({
      where: { staffRestaurantId: restaurantId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
  }

  async countByRole(): Promise<Record<string, number>> {
    const rows = await this.prisma.user.groupBy({
      by: ['role'],
      where: { deletedAt: null },
      _count: { _all: true },
    });

    return Object.fromEntries(rows.map((row) => [row.role, row._count._all]));
  }

  private buildWhere(filter: ListUsersFilter): Prisma.UserWhereInput {
    const where: Prisma.UserWhereInput = {};

    if (filter.includeDeleted !== true) {
      where.deletedAt = null;
    }

    if (filter.role !== undefined) {
      where.role = filter.role;
    }

    if (filter.status !== undefined) {
      where.status = filter.status;
    }

    if (filter.createdFrom !== undefined || filter.createdTo !== undefined) {
      where.createdAt = {
        ...(filter.createdFrom !== undefined && { gte: filter.createdFrom }),
        ...(filter.createdTo !== undefined && { lte: filter.createdTo }),
      };
    }

    if (filter.search !== undefined && filter.search.length > 0) {
      // Both columns carry GIN trigram indexes, so this stays index-backed
      // despite the leading wildcard that `contains` compiles to.
      where.OR = [
        { fullName: { contains: filter.search, mode: 'insensitive' } },
        { phone: { contains: filter.search, mode: 'insensitive' } },
        { email: { contains: filter.search, mode: 'insensitive' } },
      ];
    }

    return where;
  }
}
