import { Injectable } from '@nestjs/common';
import { Prisma, type Notification } from '@prisma/client';

import type { PaginatedResult } from '@/common/interfaces/paginated-result.interface';
import { paginate } from '@/common/utils/pagination.util';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';

import {
  NotificationRepository,
  type CreateNotificationInput,
  type ListNotificationsFilter,
  type UnreadSummary,
} from '../../domain/repositories/notification.repository';

@Injectable()
export class PrismaNotificationRepository extends NotificationRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async findMany(filter: ListNotificationsFilter): Promise<PaginatedResult<Notification>> {
    const where: Prisma.NotificationWhereInput = {
      userId: filter.userId,
      ...(filter.type && { type: filter.type }),
      ...(filter.unreadOnly === true && { isRead: false }),
      ...((filter.from || filter.to) && {
        createdAt: {
          ...(filter.from && { gte: filter.from }),
          ...(filter.to && { lte: filter.to }),
        },
      }),
    };

    const [total, items] = await this.prisma.$transaction([
      this.prisma.notification.count({ where }),
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (filter.page - 1) * filter.limit,
        take: filter.limit,
      }),
    ]);

    return paginate(items, total, filter.page, filter.limit);
  }

  async findById(id: string): Promise<Notification | null> {
    return this.prisma.notification.findUnique({ where: { id } });
  }

  async create(input: CreateNotificationInput): Promise<Notification> {
    return this.prisma.notification.create({
      data: {
        userId: input.userId,
        type: input.type,
        channel: input.channel,
        title: input.title,
        body: input.body,
        data: input.data ?? undefined,
        broadcastId: input.broadcastId ?? null,
        sentAt: new Date(),
      },
    });
  }

  async createMany(inputs: CreateNotificationInput[]): Promise<number> {
    if (inputs.length === 0) {
      return 0;
    }

    const sentAt = new Date();

    const result = await this.prisma.notification.createMany({
      data: inputs.map((input) => ({
        userId: input.userId,
        type: input.type,
        channel: input.channel,
        title: input.title,
        body: input.body,
        data: input.data ?? undefined,
        broadcastId: input.broadcastId ?? null,
        sentAt,
      })),
    });

    return result.count;
  }

  async markRead(id: string, userId: string): Promise<Notification | null> {
    // Scoped by user in the WHERE clause rather than checked beforehand: one
    // statement, and no window in which the ownership check is already stale.
    const claimed = await this.prisma.notification.updateMany({
      where: { id, userId, isRead: false },
      data: { isRead: true, readAt: new Date() },
    });

    if (claimed.count === 0) {
      // Either it is not theirs, or it was already read. Return whatever they
      // are entitled to see so a second tap is not an error.
      return this.prisma.notification.findFirst({ where: { id, userId } });
    }

    return this.prisma.notification.findUnique({ where: { id } });
  }

  async markAllRead(userId: string): Promise<number> {
    const result = await this.prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true, readAt: new Date() },
    });

    return result.count;
  }

  async unreadSummary(userId: string): Promise<UnreadSummary> {
    const grouped = await this.prisma.notification.groupBy({
      by: ['type'],
      where: { userId, isRead: false },
      _count: { _all: true },
    });

    return {
      total: grouped.reduce((sum, row) => sum + row._count._all, 0),
      byType: grouped.map((row) => ({ type: row.type, count: row._count._all })),
    };
  }

  async delete(id: string, userId: string): Promise<boolean> {
    const result = await this.prisma.notification.deleteMany({ where: { id, userId } });

    return result.count > 0;
  }

  async deleteRead(userId: string): Promise<number> {
    const result = await this.prisma.notification.deleteMany({ where: { userId, isRead: true } });

    return result.count;
  }

  async recordPushResult(
    id: string,
    result: { deliveredAt: Date | null; error: string | null },
  ): Promise<void> {
    await this.prisma.notification.update({
      where: { id },
      data: { pushSentAt: result.deliveredAt, pushError: result.error },
    });
  }

  async purgeOlderThan(before: Date): Promise<number> {
    // Only read notifications are dropped. An unread one is a message the user
    // has not seen yet, however old it is.
    const result = await this.prisma.notification.deleteMany({
      where: { isRead: true, createdAt: { lt: before } },
    });

    return result.count;
  }
}
