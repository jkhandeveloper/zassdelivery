import { Injectable } from '@nestjs/common';
import { TicketPriority, TicketStatus, UserRole } from '@prisma/client';

import {
  ForbiddenOperationException,
  ResourceNotFoundException,
} from '@/common/exceptions/domain.exception';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import type { PaginatedResult } from '@/common/interfaces/paginated-result.interface';
import { buildOrderBy } from '@/common/utils/pagination.util';

import {
  AuditLogRepository,
  SupportTicketRepository,
  type TicketWithContext,
} from '../../domain/repositories/admin.repository';
import { TicketWorkflow } from '../../domain/services/ticket-workflow';
import {
  toAuditLogDto,
  toTicketDto,
  type AuditLogDto,
  type TicketDto,
} from '../dto/admin-response.dto';
import {
  TICKET_SORT_FIELDS,
  type AddTicketMessageDto,
  type AssignTicketDto,
  type ChangeTicketPriorityDto,
  type ChangeTicketStatusDto,
  type CreateTicketDto,
  type ListAuditLogsQueryDto,
  type ListTicketsQueryDto,
} from '../dto/admin.dto';

function isStaff(actor: AuthenticatedUser): boolean {
  return actor.role === UserRole.ADMIN || actor.role === UserRole.SUPER_ADMIN;
}

/**
 * Loads a ticket and decides what the caller may see of it.
 *
 * The distinction that matters is internal notes: agents hand a thread over by
 * writing to each other in it, and none of that is meant for the person
 * waiting on the other side.
 */
@Injectable()
export class TicketAccessService {
  constructor(private readonly tickets: SupportTicketRepository) {}

  async load(id: string): Promise<TicketWithContext> {
    const ticket = await this.tickets.findById(id);

    if (!ticket) {
      throw new ResourceNotFoundException('Ticket', id);
    }

    return ticket;
  }

  async loadFor(id: string, actor: AuthenticatedUser): Promise<TicketWithContext> {
    const ticket = await this.load(id);

    if (isStaff(actor) || ticket.userId === actor.id) {
      return ticket;
    }

    // 404 rather than 403: confirming a ticket id exists tells a stranger that
    // somebody complained, which is itself a disclosure.
    throw new ResourceNotFoundException('Ticket', id);
  }
}

@Injectable()
export class CreateTicketUseCase {
  constructor(private readonly tickets: SupportTicketRepository) {}

  async execute(dto: CreateTicketDto, actor: AuthenticatedUser): Promise<TicketDto> {
    const ticket = await this.tickets.create({
      userId: actor.id,
      orderId: dto.orderId ?? null,
      category: dto.category,
      priority: dto.priority ?? TicketPriority.MEDIUM,
      subject: dto.subject,
      message: dto.message,
      attachmentUrl: dto.attachmentUrl ?? null,
    });

    return toTicketDto(ticket, { includeInternal: false });
  }
}

@Injectable()
export class ListTicketsUseCase {
  constructor(private readonly tickets: SupportTicketRepository) {}

  async execute(
    query: ListTicketsQueryDto,
    scope: { userId?: string; includeInternal?: boolean } = {},
  ): Promise<PaginatedResult<TicketDto>> {
    const orderBy = buildOrderBy(query.sortBy, query.sortOrder, TICKET_SORT_FIELDS, 'createdAt');

    const result = await this.tickets.findMany({
      page: query.page,
      limit: query.limit,
      orderBy,
      // The scope wins over the query string, so a customer cannot read
      // somebody else's complaints by passing a userId.
      userId: scope.userId ?? query.userId,
      assignedToId: query.assignedToId,
      status: query.status,
      priority: query.priority,
      category: query.category,
      openOnly: query.openOnly,
      search: query.search,
      from: query.from,
      to: query.to,
    });

    return {
      items: result.items.map((ticket) =>
        toTicketDto(ticket, { includeInternal: scope.includeInternal }),
      ),
      meta: result.meta,
    };
  }
}

@Injectable()
export class GetTicketUseCase {
  constructor(private readonly access: TicketAccessService) {}

  async execute(id: string, actor: AuthenticatedUser): Promise<TicketDto> {
    const ticket = await this.access.loadFor(id, actor);

    return toTicketDto(ticket, { includeInternal: isStaff(actor) });
  }
}

@Injectable()
export class ReplyToTicketUseCase {
  constructor(
    private readonly tickets: SupportTicketRepository,
    private readonly access: TicketAccessService,
  ) {}

  /**
   * Adds a message to the thread.
   *
   * A customer's reply moves a resolved or waiting ticket back into the queue,
   * because that reply *is* the thing that was being waited for — leaving it
   * marked resolved is how a complaint quietly stops being anybody's job.
   */
  async execute(
    id: string,
    dto: AddTicketMessageDto,
    actor: AuthenticatedUser,
  ): Promise<TicketDto> {
    const ticket = await this.access.loadFor(id, actor);
    const staff = isStaff(actor);

    if (!staff && !TicketWorkflow.customerMayReply(ticket.status)) {
      throw new ForbiddenOperationException(
        'This ticket is closed. Open a new one and reference this number.',
      );
    }

    // Only staff can write a note the customer never sees. A customer flagging
    // their own message internal would simply hide it from the agent.
    const isInternal = staff && dto.isInternal === true;

    const nextStatus = staff
      ? isInternal
        ? null
        : ticket.status === TicketStatus.OPEN
          ? TicketStatus.IN_PROGRESS
          : null
      : TicketWorkflow.statusAfterCustomerReply(ticket.status);

    const updated = await this.tickets.addMessage(id, {
      senderId: actor.id,
      message: dto.message,
      attachmentUrl: dto.attachmentUrl ?? null,
      isInternal,
      nextStatus: nextStatus === ticket.status ? null : nextStatus,
    });

    return toTicketDto(updated, { includeInternal: staff });
  }
}

@Injectable()
export class ChangeTicketStatusUseCase {
  constructor(
    private readonly tickets: SupportTicketRepository,
    private readonly access: TicketAccessService,
  ) {}

  async execute(
    id: string,
    dto: ChangeTicketStatusDto,
    actor: AuthenticatedUser,
  ): Promise<TicketDto> {
    const ticket = await this.access.load(id);

    TicketWorkflow.assertTransition(ticket.status, dto.status);

    const updated = await this.tickets.setStatus(id, dto.status, { actorId: actor.id });

    return toTicketDto(updated, { includeInternal: true });
  }
}

@Injectable()
export class AssignTicketUseCase {
  constructor(
    private readonly tickets: SupportTicketRepository,
    private readonly access: TicketAccessService,
  ) {}

  async execute(id: string, dto: AssignTicketDto): Promise<TicketDto> {
    await this.access.load(id);

    const updated = await this.tickets.assign(id, dto.assigneeId ?? null);

    return toTicketDto(updated, { includeInternal: true });
  }
}

@Injectable()
export class ChangeTicketPriorityUseCase {
  constructor(
    private readonly tickets: SupportTicketRepository,
    private readonly access: TicketAccessService,
  ) {}

  async execute(id: string, dto: ChangeTicketPriorityDto): Promise<TicketDto> {
    await this.access.load(id);

    const updated = await this.tickets.setPriority(id, dto.priority);

    return toTicketDto(updated, { includeInternal: true });
  }
}

@Injectable()
export class TicketQueueSummaryUseCase {
  constructor(private readonly tickets: SupportTicketRepository) {}

  /** Counts per status, for the queue tabs. */
  async execute(): Promise<{
    byStatus: Array<{ status: TicketStatus; count: number }>;
    open: number;
  }> {
    const byStatus = await this.tickets.countsByStatus();

    return {
      byStatus,
      open: byStatus
        .filter((row) => TicketWorkflow.isOpen(row.status))
        .reduce((sum, row) => sum + row.count, 0),
    };
  }
}

// ── Audit log ──────────────────────────────────────────────────

@Injectable()
export class ListAuditLogsUseCase {
  constructor(private readonly audit: AuditLogRepository) {}

  async execute(query: ListAuditLogsQueryDto): Promise<PaginatedResult<AuditLogDto>> {
    const result = await this.audit.findMany({
      page: query.page,
      limit: query.limit,
      actorId: query.actorId,
      action: query.action,
      entityType: query.entityType,
      entityId: query.entityId,
      from: query.from,
      to: query.to,
    });

    return { items: result.items.map(toAuditLogDto), meta: result.meta };
  }
}

@Injectable()
export class EntityHistoryUseCase {
  constructor(private readonly audit: AuditLogRepository) {}

  /**
   * Everything that has ever happened to one record.
   *
   * The question an audit log exists to answer — "who changed this, and to
   * what" — is about a record, not about a day, and answering it by scrolling a
   * chronological feed is how nobody ever uses one.
   */
  async execute(entityType: string, entityId: string): Promise<AuditLogDto[]> {
    const entries = await this.audit.historyFor(entityType, entityId);

    return entries.map(toAuditLogDto);
  }
}

@Injectable()
export class AuditFacetsUseCase {
  constructor(private readonly audit: AuditLogRepository) {}

  /** The entity types actually present, so a filter can be built from data. */
  async execute(): Promise<{ entityTypes: string[] }> {
    return { entityTypes: await this.audit.entityTypes() };
  }
}
