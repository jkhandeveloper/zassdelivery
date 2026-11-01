import { randomBytes } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import {
  DriverAvailability,
  DriverStatus,
  OrderStatus,
  SubscriptionInvoiceStatus,
  SubscriptionStatus,
  Prisma,
  UserStatus,
  type User,
} from '@prisma/client';

import type { PaginatedResult } from '@/common/interfaces/paginated-result.interface';
import { paginate } from '@/common/utils/pagination.util';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';

import {
  ERASED_PHONE_PREFIX,
  UserRepository,
  type CreateUserInput,
  type ListUsersFilter,
  type UpdateUserInput,
} from '../../domain/repositories/user.repository';

/** Orders that are still being paid for, cooked or carried. */
const ACTIVE_ORDER_STATUSES: OrderStatus[] = [
  OrderStatus.PENDING_PAYMENT,
  OrderStatus.PLACED,
  OrderStatus.CONFIRMED,
  OrderStatus.PREPARING,
  OrderStatus.READY_FOR_PICKUP,
  OrderStatus.PICKED_UP,
  OrderStatus.ON_THE_WAY,
];

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

  async hasActiveOrders(id: string): Promise<boolean> {
    const active = await this.prisma.order.count({
      where: {
        status: { in: ACTIVE_ORDER_STATUSES },
        OR: [{ customerId: id }, { restaurant: { ownerId: id } }, { driver: { userId: id } }],
      },
    });

    return active > 0;
  }

  async erase(id: string): Promise<string[]> {
    const now = new Date();
    // `phone` and `cnic` are unique and required, so they are overwritten rather
    // than cleared. Doing so also lets this person sign up again later.
    const marker = randomBytes(8).toString('hex');

    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUniqueOrThrow({
        where: { id },
        select: {
          avatarUrl: true,
          driverProfile: { select: { id: true, documents: { select: { fileUrl: true } } } },
        },
      });

      // The record of each order stays for the accounts; who it went to and
      // where does not.
      await tx.order.updateMany({
        where: { customerId: id },
        data: {
          deliveryLine1: null,
          deliveryLandmark: null,
          deliveryLat: null,
          deliveryLng: null,
          recipientName: null,
          recipientPhone: null,
          deliveryNotes: null,
          customerNote: null,
        },
      });

      await tx.cart.deleteMany({ where: { userId: id } });
      await tx.address.deleteMany({ where: { userId: id } });
      await tx.favorite.deleteMany({ where: { userId: id } });
      await tx.notification.deleteMany({ where: { userId: id } });
      await tx.notificationPreference.deleteMany({ where: { userId: id } });
      await tx.deviceToken.deleteMany({ where: { userId: id } });

      if (user.driverProfile !== null) {
        await tx.driverDocument.deleteMany({ where: { driverId: user.driverProfile.id } });
        await tx.driver.update({
          where: { id: user.driverProfile.id },
          data: {
            cnic: `del${marker.slice(0, 12)}`,
            licenseNumber: null,
            status: DriverStatus.SUSPENDED,
            availability: DriverAvailability.OFFLINE,
            currentLat: null,
            currentLng: null,
            lastLocationAt: null,
            onlineSince: null,
            payoutBankName: null,
            payoutAccountTitle: null,
            payoutAccountNumber: null,
            paymentQrCodes: Prisma.DbNull,
            deletedAt: now,
          },
        });
      }

      await tx.restaurant.updateMany({
        where: { ownerId: id, deletedAt: null },
        data: { deletedAt: now, isAcceptingOrders: false },
      });

      // Before the subscription closes: the nightly sweep would otherwise find
      // an unpaid invoice and suspend a business that no longer exists.
      await tx.subscriptionInvoice.updateMany({
        where: {
          subscription: { ownerId: id },
          status: {
            in: [SubscriptionInvoiceStatus.OPEN, SubscriptionInvoiceStatus.PENDING_REVIEW],
          },
        },
        data: {
          status: SubscriptionInvoiceStatus.VOID,
          voidReason: 'The owner deleted their account.',
        },
      });

      await tx.vendorSubscription.updateMany({
        where: { ownerId: id },
        data: { status: SubscriptionStatus.CANCELLED },
      });

      await tx.user.update({
        where: { id },
        data: {
          phone: `${ERASED_PHONE_PREFIX}${marker}`,
          phoneVerifiedAt: null,
          email: null,
          emailVerifiedAt: null,
          passwordHash: null,
          fullName: 'Deleted user',
          avatarUrl: null,
          pushToken: null,
          status: UserStatus.BANNED,
          deletedAt: now,
        },
      });

      const documents = user.driverProfile?.documents.map((document) => document.fileUrl) ?? [];

      return user.avatarUrl === null ? documents : [user.avatarUrl, ...documents];
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
