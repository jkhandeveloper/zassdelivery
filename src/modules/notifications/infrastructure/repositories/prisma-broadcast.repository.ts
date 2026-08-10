import { Injectable } from '@nestjs/common';
import {
  BroadcastAudience,
  BroadcastStatus,
  OrderStatus,
  Prisma,
  UserStatus,
  type Broadcast,
} from '@prisma/client';

import type { PaginatedResult } from '@/common/interfaces/paginated-result.interface';
import { paginate } from '@/common/utils/pagination.util';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';

import {
  BroadcastRepository,
  type BroadcastCounts,
  type CreateBroadcastInput,
} from '../../domain/repositories/notification.repository';

type AudienceSpec = Pick<Broadcast, 'audience' | 'roleFilter' | 'zoneId' | 'userIds'>;

@Injectable()
export class PrismaBroadcastRepository extends BroadcastRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async findMany(filter: {
    page: number;
    limit: number;
    status?: BroadcastStatus;
    from?: Date;
    to?: Date;
  }): Promise<PaginatedResult<Broadcast>> {
    const where: Prisma.BroadcastWhereInput = {
      ...(filter.status && { status: filter.status }),
      ...((filter.from || filter.to) && {
        createdAt: {
          ...(filter.from && { gte: filter.from }),
          ...(filter.to && { lte: filter.to }),
        },
      }),
    };

    const [total, items] = await this.prisma.$transaction([
      this.prisma.broadcast.count({ where }),
      this.prisma.broadcast.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (filter.page - 1) * filter.limit,
        take: filter.limit,
      }),
    ]);

    return paginate(items, total, filter.page, filter.limit);
  }

  async findById(id: string): Promise<Broadcast | null> {
    return this.prisma.broadcast.findUnique({ where: { id } });
  }

  async create(input: CreateBroadcastInput): Promise<Broadcast> {
    return this.prisma.broadcast.create({
      data: {
        title: input.title,
        body: input.body,
        type: input.type,
        data: input.data ?? undefined,
        audience: input.audience,
        roleFilter: input.roleFilter,
        zoneId: input.zoneId,
        userIds: input.userIds,
        channels: input.channels,
        scheduledFor: input.scheduledFor,
        status: input.scheduledFor === null ? BroadcastStatus.DRAFT : BroadcastStatus.SCHEDULED,
        createdById: input.createdById,
      },
    });
  }

  async update(id: string, input: Partial<CreateBroadcastInput>): Promise<Broadcast> {
    return this.prisma.broadcast.update({
      where: { id },
      data: {
        ...(input.title !== undefined && { title: input.title }),
        ...(input.body !== undefined && { body: input.body }),
        ...(input.type !== undefined && { type: input.type }),
        ...(input.data !== undefined && { data: input.data ?? Prisma.DbNull }),
        ...(input.audience !== undefined && { audience: input.audience }),
        ...(input.roleFilter !== undefined && { roleFilter: input.roleFilter }),
        ...(input.zoneId !== undefined && { zoneId: input.zoneId }),
        ...(input.userIds !== undefined && { userIds: input.userIds }),
        ...(input.channels !== undefined && { channels: input.channels }),
        ...(input.scheduledFor !== undefined && {
          scheduledFor: input.scheduledFor,
          status: input.scheduledFor === null ? BroadcastStatus.DRAFT : BroadcastStatus.SCHEDULED,
        }),
      },
    });
  }

  async setStatus(
    id: string,
    status: BroadcastStatus,
    context: { error?: string | null; counts?: BroadcastCounts } = {},
  ): Promise<Broadcast> {
    return this.prisma.broadcast.update({
      where: { id },
      data: {
        status,
        error: context.error ?? null,
        ...(status === BroadcastStatus.SENDING && { startedAt: new Date() }),
        ...((status === BroadcastStatus.SENT || status === BroadcastStatus.FAILED) && {
          completedAt: new Date(),
        }),
        ...(context.counts?.recipientCount !== undefined && {
          recipientCount: context.counts.recipientCount,
        }),
        ...(context.counts?.deliveredCount !== undefined && {
          deliveredCount: context.counts.deliveredCount,
        }),
        ...(context.counts?.failedCount !== undefined && {
          failedCount: context.counts.failedCount,
        }),
        ...(context.counts?.skippedCount !== undefined && {
          skippedCount: context.counts.skippedCount,
        }),
      },
    });
  }

  async addCounts(id: string, counts: BroadcastCounts): Promise<void> {
    // Incremental rather than a recomputed total: a long fan-out should show
    // progress while it runs, not a number that appears at the end.
    await this.prisma.broadcast.update({
      where: { id },
      data: {
        ...(counts.recipientCount !== undefined && {
          recipientCount: { increment: counts.recipientCount },
        }),
        ...(counts.deliveredCount !== undefined && {
          deliveredCount: { increment: counts.deliveredCount },
        }),
        ...(counts.failedCount !== undefined && {
          failedCount: { increment: counts.failedCount },
        }),
        ...(counts.skippedCount !== undefined && {
          skippedCount: { increment: counts.skippedCount },
        }),
      },
    });
  }

  async resolveAudience(
    broadcast: AudienceSpec,
    cursor: string | null,
    take: number,
  ): Promise<Array<{ id: string }>> {
    // Keyset pagination on the primary key: a campaign to everyone walks the
    // table in fixed-cost pages, where OFFSET would get slower with every batch
    // exactly when the campaign is largest.
    return this.prisma.user.findMany({
      where: this.audienceWhere(broadcast),
      select: { id: true },
      orderBy: { id: 'asc' },
      ...(cursor !== null && { cursor: { id: cursor }, skip: 1 }),
      take,
    });
  }

  async countAudience(broadcast: AudienceSpec): Promise<number> {
    return this.prisma.user.count({ where: this.audienceWhere(broadcast) });
  }

  async findDue(now: Date, limit: number): Promise<Broadcast[]> {
    return this.prisma.broadcast.findMany({
      where: { status: BroadcastStatus.SCHEDULED, scheduledFor: { lte: now } },
      orderBy: { scheduledFor: 'asc' },
      take: limit,
    });
  }

  /**
   * Turns an audience into a query.
   *
   * Every audience carries the same two floors — active accounts that have not
   * been deleted — because a suspended or removed user should never be sent a
   * marketing message, whatever the campaign says.
   */
  private audienceWhere(broadcast: AudienceSpec): Prisma.UserWhereInput {
    const base: Prisma.UserWhereInput = { deletedAt: null, status: UserStatus.ACTIVE };

    switch (broadcast.audience) {
      case BroadcastAudience.ROLE:
        return { ...base, ...(broadcast.roleFilter !== null && { role: broadcast.roleFilter }) };

      case BroadcastAudience.ZONE:
        return {
          ...base,
          ...(broadcast.zoneId !== null && {
            addresses: { some: { zoneId: broadcast.zoneId, deletedAt: null } },
          }),
        };

      case BroadcastAudience.ACTIVE_CUSTOMERS:
        // Anyone who has actually bought something. A "customer" who only ever
        // registered is a different audience, and usually a different message.
        return {
          ...base,
          orders: {
            some: {
              status: {
                in: [
                  OrderStatus.DELIVERED,
                  OrderStatus.PICKED_UP,
                  OrderStatus.ON_THE_WAY,
                  OrderStatus.PREPARING,
                  OrderStatus.CONFIRMED,
                ],
              },
            },
          },
        };

      case BroadcastAudience.USER_IDS:
        return { ...base, id: { in: broadcast.userIds } };

      default:
        return base;
    }
  }
}
