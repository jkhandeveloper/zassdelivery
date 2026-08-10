import { Injectable } from '@nestjs/common';
import { Prisma, TicketStatus, type TicketPriority } from '@prisma/client';

import type { PaginatedResult } from '@/common/interfaces/paginated-result.interface';
import { paginate } from '@/common/utils/pagination.util';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';

import {
  AuditLogRepository,
  SupportTicketRepository,
  type AuditEntryInput,
  type AuditLogWithActor,
  type CreateTicketInput,
  type ListAuditFilter,
  type ListTicketsFilter,
  type TicketWithContext,
} from '../../domain/repositories/admin.repository';
import { OPEN_STATUSES } from '../../domain/services/ticket-workflow';

const TICKET_CONTEXT = {
  user: { select: { id: true, fullName: true, phone: true } },
  assignedTo: { select: { id: true, fullName: true } },
  order: { select: { id: true, orderNumber: true } },
  messages: {
    include: { sender: { select: { id: true, fullName: true, role: true } } },
    orderBy: { createdAt: 'asc' },
  },
} satisfies Prisma.SupportTicketInclude;

@Injectable()
export class PrismaSupportTicketRepository extends SupportTicketRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async findMany(filter: ListTicketsFilter): Promise<PaginatedResult<TicketWithContext>> {
    const where: Prisma.SupportTicketWhereInput = {
      ...(filter.userId && { userId: filter.userId }),
      ...(filter.assignedToId && { assignedToId: filter.assignedToId }),
      ...(filter.status && { status: filter.status }),
      ...(filter.priority && { priority: filter.priority }),
      ...(filter.category && { category: filter.category }),
      ...(filter.openOnly === true && { status: { in: OPEN_STATUSES } }),
      ...(filter.search && {
        OR: [
          { ticketNumber: { contains: filter.search, mode: 'insensitive' } },
          { subject: { contains: filter.search, mode: 'insensitive' } },
        ],
      }),
      ...((filter.from || filter.to) && {
        createdAt: {
          ...(filter.from && { gte: filter.from }),
          ...(filter.to && { lte: filter.to }),
        },
      }),
    };

    const [total, items] = await this.prisma.$transaction([
      this.prisma.supportTicket.count({ where }),
      this.prisma.supportTicket.findMany({
        where,
        include: TICKET_CONTEXT,
        orderBy: filter.orderBy,
        skip: (filter.page - 1) * filter.limit,
        take: filter.limit,
      }),
    ]);

    return paginate(items, total, filter.page, filter.limit);
  }

  async findById(id: string): Promise<TicketWithContext | null> {
    return this.prisma.supportTicket.findUnique({ where: { id }, include: TICKET_CONTEXT });
  }

  async create(input: CreateTicketInput): Promise<TicketWithContext> {
    // The ticket and its opening message land together: a ticket with no
    // message is a subject line nobody can act on, and it is exactly what a
    // half-applied create would leave behind.
    return this.prisma.$transaction(async (tx) => {
      const ticketNumber = await this.nextTicketNumber(tx);

      const ticket = await tx.supportTicket.create({
        data: {
          ticketNumber,
          userId: input.userId,
          orderId: input.orderId,
          category: input.category,
          priority: input.priority,
          subject: input.subject,
        },
      });

      await tx.supportTicketMessage.create({
        data: {
          ticketId: ticket.id,
          senderId: input.userId,
          message: input.message,
          attachmentUrl: input.attachmentUrl,
        },
      });

      return tx.supportTicket.findUniqueOrThrow({
        where: { id: ticket.id },
        include: TICKET_CONTEXT,
      });
    });
  }

  async addMessage(
    ticketId: string,
    input: {
      senderId: string;
      message: string;
      attachmentUrl: string | null;
      isInternal: boolean;
      nextStatus: TicketStatus | null;
    },
  ): Promise<TicketWithContext> {
    return this.prisma.$transaction(async (tx) => {
      await tx.supportTicketMessage.create({
        data: {
          ticketId,
          senderId: input.senderId,
          message: input.message,
          attachmentUrl: input.attachmentUrl,
          isInternal: input.isInternal,
        },
      });

      if (input.nextStatus !== null) {
        await tx.supportTicket.update({
          where: { id: ticketId },
          data: {
            status: input.nextStatus,
            ...(input.nextStatus === TicketStatus.RESOLVED && { resolvedAt: new Date() }),
            ...(input.nextStatus === TicketStatus.CLOSED && { closedAt: new Date() }),
          },
        });
      } else {
        // Touched even without a status change, so the queue can be sorted by
        // "last activity" — the order a support desk actually works in.
        await tx.supportTicket.update({ where: { id: ticketId }, data: { updatedAt: new Date() } });
      }

      return tx.supportTicket.findUniqueOrThrow({
        where: { id: ticketId },
        include: TICKET_CONTEXT,
      });
    });
  }

  async setStatus(
    id: string,
    status: TicketStatus,
    context: { actorId: string },
  ): Promise<TicketWithContext> {
    return this.prisma.$transaction(async (tx) => {
      await tx.supportTicket.update({
        where: { id },
        data: {
          status,
          ...(status === TicketStatus.RESOLVED && { resolvedAt: new Date() }),
          ...(status === TicketStatus.CLOSED && { closedAt: new Date() }),
          // Reopening clears the marks, so "resolved 3 days ago" never sits on
          // a ticket that is open again.
          ...(status === TicketStatus.IN_PROGRESS && { resolvedAt: null, closedAt: null }),
          // Whoever moved it owns it, unless somebody already does.
          ...(status === TicketStatus.IN_PROGRESS && { assignedToId: context.actorId }),
        },
      });

      return tx.supportTicket.findUniqueOrThrow({ where: { id }, include: TICKET_CONTEXT });
    });
  }

  async assign(id: string, assigneeId: string | null): Promise<TicketWithContext> {
    return this.prisma.supportTicket.update({
      where: { id },
      data: { assignedToId: assigneeId },
      include: TICKET_CONTEXT,
    });
  }

  async setPriority(id: string, priority: TicketPriority): Promise<TicketWithContext> {
    return this.prisma.supportTicket.update({
      where: { id },
      data: { priority },
      include: TICKET_CONTEXT,
    });
  }

  async countsByStatus(): Promise<Array<{ status: TicketStatus; count: number }>> {
    const grouped = await this.prisma.supportTicket.groupBy({
      by: ['status'],
      _count: { _all: true },
    });

    return grouped.map((row) => ({ status: row.status, count: row._count._all }));
  }

  /**
   * Builds the next ticket reference, e.g. `TKT-260810-0001`.
   *
   * From a sequence rather than a row count, for the same reason order numbers
   * are: two tickets opened in the same millisecond would otherwise compute the
   * same number and one would fail on the unique index at random.
   */
  private async nextTicketNumber(tx: Prisma.TransactionClient): Promise<string> {
    const [row] = await tx.$queryRaw<Array<{ value: bigint }>>`
      SELECT nextval('support_ticket_seq') AS value
    `;

    const today = new Date();
    const stamp = [
      String(today.getFullYear()).slice(2),
      String(today.getMonth() + 1).padStart(2, '0'),
      String(today.getDate()).padStart(2, '0'),
    ].join('');

    return `TKT-${stamp}-${String(Number(row?.value ?? 1)).padStart(4, '0')}`;
  }
}

@Injectable()
export class PrismaAuditLogRepository extends AuditLogRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async record(input: AuditEntryInput): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        actorId: input.actorId,
        actorRole: input.actorRole,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        before: input.before ?? undefined,
        after: input.after ?? undefined,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent?.slice(0, 400) ?? null,
        requestId: input.requestId,
      },
    });
  }

  async findMany(filter: ListAuditFilter): Promise<PaginatedResult<AuditLogWithActor>> {
    const where: Prisma.AuditLogWhereInput = {
      ...(filter.actorId && { actorId: filter.actorId }),
      ...(filter.action && { action: filter.action }),
      ...(filter.entityType && { entityType: filter.entityType }),
      ...(filter.entityId && { entityId: filter.entityId }),
      ...((filter.from || filter.to) && {
        createdAt: {
          ...(filter.from && { gte: filter.from }),
          ...(filter.to && { lte: filter.to }),
        },
      }),
    };

    const [total, items] = await this.prisma.$transaction([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({
        where,
        include: { actor: { select: { id: true, fullName: true, phone: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (filter.page - 1) * filter.limit,
        take: filter.limit,
      }),
    ]);

    return paginate(items, total, filter.page, filter.limit);
  }

  async findById(id: string): Promise<AuditLogWithActor | null> {
    return this.prisma.auditLog.findUnique({
      where: { id },
      include: { actor: { select: { id: true, fullName: true, phone: true } } },
    });
  }

  async historyFor(entityType: string, entityId: string): Promise<AuditLogWithActor[]> {
    // Oldest first: the history of one record reads as a story, and a story
    // told backwards is harder to follow than it needs to be.
    return this.prisma.auditLog.findMany({
      where: { entityType, entityId },
      include: { actor: { select: { id: true, fullName: true, phone: true } } },
      orderBy: { createdAt: 'asc' },
      take: 200,
    });
  }

  async entityTypes(): Promise<string[]> {
    const grouped = await this.prisma.auditLog.groupBy({
      by: ['entityType'],
      orderBy: { entityType: 'asc' },
    });

    return grouped.map((row) => row.entityType);
  }
}
