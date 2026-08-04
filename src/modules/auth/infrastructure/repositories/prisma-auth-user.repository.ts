import { Injectable } from '@nestjs/common';
import { UserStatus, type Prisma } from '@prisma/client';

import { PrismaService } from '@/infrastructure/prisma/prisma.service';

import {
  AuthUserRepository,
  type AuthUserRecord,
  type CreateAuthUserInput,
} from '../../domain/repositories/auth-user.repository';

/**
 * Loads the user together with the permissions granted by every role assigned
 * to them, in one query rather than a per-role fan-out.
 */
const WITH_PERMISSIONS = {
  roleAssignments: {
    select: {
      role: {
        select: {
          permissions: { select: { permission: { select: { code: true } } } },
        },
      },
    },
  },
} satisfies Prisma.UserInclude;

type UserWithRoles = Prisma.UserGetPayload<{ include: typeof WITH_PERMISSIONS }>;

@Injectable()
export class PrismaAuthUserRepository extends AuthUserRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async findByPhone(phone: string): Promise<AuthUserRecord | null> {
    const user = await this.prisma.user.findUnique({
      where: { phone },
      include: WITH_PERMISSIONS,
    });

    return user ? this.toRecord(user) : null;
  }

  async findById(id: string): Promise<AuthUserRecord | null> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: WITH_PERMISSIONS,
    });

    return user ? this.toRecord(user) : null;
  }

  async existsByPhone(phone: string): Promise<boolean> {
    // `select: { id: true }` keeps this an index-only lookup — the row body is
    // never needed just to answer "does this exist".
    const found = await this.prisma.user.findUnique({ where: { phone }, select: { id: true } });
    return found !== null;
  }

  async existsByEmail(email: string): Promise<boolean> {
    const found = await this.prisma.user.findUnique({ where: { email }, select: { id: true } });
    return found !== null;
  }

  async create(input: CreateAuthUserInput): Promise<AuthUserRecord> {
    // The account, its role assignment and its wallet are created together:
    // a user without a wallet would break the first refund that touches them.
    const user = await this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          phone: input.phone,
          fullName: input.fullName,
          passwordHash: input.passwordHash,
          email: input.email ?? null,
          role: input.role,
          status: UserStatus.ACTIVE,
        },
      });

      const role = await tx.role.findUnique({
        where: { slug: input.role.toLowerCase() },
        select: { id: true },
      });

      if (role) {
        await tx.userRoleAssignment.create({
          data: { userId: created.id, roleId: role.id },
        });
      }

      await tx.wallet.create({ data: { userId: created.id } });

      return tx.user.findUniqueOrThrow({
        where: { id: created.id },
        include: WITH_PERMISSIONS,
      });
    });

    return this.toRecord(user);
  }

  async updatePassword(userId: string, passwordHash: string): Promise<void> {
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash } });
  }

  async recordLogin(userId: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { lastLoginAt: new Date() },
    });
  }

  /** Flattens nested role→permission rows into a de-duplicated code list. */
  private toRecord(user: UserWithRoles): AuthUserRecord {
    const permissions = new Set<string>();

    for (const assignment of user.roleAssignments) {
      for (const entry of assignment.role.permissions) {
        permissions.add(entry.permission.code);
      }
    }

    const { roleAssignments: _roleAssignments, ...rest } = user;

    return { ...rest, permissions: [...permissions] };
  }
}
