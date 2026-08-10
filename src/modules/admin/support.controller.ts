import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { TicketStatus, UserRole } from '@prisma/client';

import { ApiPaginatedResponse } from '@/common/decorators/api-paginated-response.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { RequirePermissions } from '@/common/decorators/permissions.decorator';
import { ApiErrorResponseDto } from '@/common/dto/api-response.dto';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import type { PaginatedResult } from '@/common/interfaces/paginated-result.interface';

import { AuditLogDto, TicketDto } from './application/dto/admin-response.dto';
import {
  AddTicketMessageDto,
  AssignTicketDto,
  ChangeTicketPriorityDto,
  ChangeTicketStatusDto,
  CreateTicketDto,
  ListAuditLogsQueryDto,
  ListTicketsQueryDto,
} from './application/dto/admin.dto';
import {
  AssignTicketUseCase,
  AuditFacetsUseCase,
  ChangeTicketPriorityUseCase,
  ChangeTicketStatusUseCase,
  CreateTicketUseCase,
  EntityHistoryUseCase,
  GetTicketUseCase,
  ListAuditLogsUseCase,
  ListTicketsUseCase,
  ReplyToTicketUseCase,
  TicketQueueSummaryUseCase,
} from './application/use-cases/support.use-cases';

function isStaff(actor: AuthenticatedUser): boolean {
  return actor.role === UserRole.ADMIN || actor.role === UserRole.SUPER_ADMIN;
}

/**
 * Support conversations, from both sides.
 *
 * One set of routes rather than a customer copy and a staff copy, because the
 * thread is the same thread — what differs is what each side may see of it, and
 * that is a filter on the messages rather than a second API.
 */
@ApiTags('Support')
@ApiBearerAuth('access-token')
@ApiResponse({ status: 401, description: 'Not authenticated.', type: ApiErrorResponseDto })
@ApiResponse({ status: 404, description: 'Not found, or not yours.', type: ApiErrorResponseDto })
@Controller('support-tickets')
export class SupportController {
  constructor(
    private readonly create: CreateTicketUseCase,
    private readonly list: ListTicketsUseCase,
    private readonly get: GetTicketUseCase,
    private readonly reply: ReplyToTicketUseCase,
    private readonly changeStatus: ChangeTicketStatusUseCase,
    private readonly assign: AssignTicketUseCase,
    private readonly changePriority: ChangeTicketPriorityUseCase,
    private readonly summary: TicketQueueSummaryUseCase,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Open a ticket',
    description:
      'The ticket and its first message are written together — a ticket with ' +
      'no message is a subject line nobody can act on. Reference an order when ' +
      'there is one; it saves the agent a search.',
  })
  @ApiResponse({ status: 201, type: TicketDto })
  open(@Body() dto: CreateTicketDto, @CurrentUser() actor: AuthenticatedUser): Promise<TicketDto> {
    return this.create.execute(dto, actor);
  }

  @Get()
  @ApiOperation({
    summary: 'Tickets',
    description:
      'A customer sees their own. Staff see everything, filtered by status, ' +
      'priority, category or assignee — `openOnly=true` is the working queue.',
  })
  @ApiPaginatedResponse(TicketDto)
  tickets(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: ListTicketsQueryDto,
  ): Promise<PaginatedResult<TicketDto>> {
    const staff = isStaff(actor);

    return this.list.execute(query, {
      // Scoped for a customer whatever the query string says.
      userId: staff ? undefined : actor.id,
      includeInternal: staff,
    });
  }

  @Get('queue-summary')
  @RequirePermissions('tickets.read')
  @ApiOperation({ summary: 'Ticket counts per status', description: 'For the queue tabs.' })
  @ApiResponse({ status: 200, description: 'Counts by status, and the open total.' })
  queueSummary(): Promise<{
    byStatus: Array<{ status: TicketStatus; count: number }>;
    open: number;
  }> {
    return this.summary.execute();
  }

  @Get(':id')
  @ApiParam({ name: 'id' })
  @ApiOperation({
    summary: 'One ticket, with its thread',
    description:
      'Internal notes are included for staff and stripped for the customer — ' +
      'agents hand a thread over by writing to each other in it, and none of ' +
      'that is meant for the person waiting.',
  })
  @ApiResponse({ status: 200, type: TicketDto })
  ticket(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser): Promise<TicketDto> {
    return this.get.execute(id, actor);
  }

  @Post(':id/messages')
  @HttpCode(HttpStatus.CREATED)
  @ApiParam({ name: 'id' })
  @ApiOperation({
    summary: 'Reply to a ticket',
    description:
      'A customer’s reply moves a resolved or waiting ticket back into the ' +
      'queue — that reply is the thing that was being waited for, and leaving ' +
      'it marked resolved is how a complaint quietly stops being anybody’s job. ' +
      '`isInternal` is staff-only and never reaches the customer.',
  })
  @ApiResponse({ status: 201, type: TicketDto })
  @ApiResponse({ status: 403, description: 'The ticket is closed.' })
  addMessage(
    @Param('id') id: string,
    @Body() dto: AddTicketMessageDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<TicketDto> {
    return this.reply.execute(id, dto, actor);
  }

  @Patch(':id/status')
  @RequirePermissions('tickets.update')
  @ApiParam({ name: 'id' })
  @ApiOperation({
    summary: 'Move a ticket',
    description:
      'A resolved ticket can be reopened — "that did not fix it" is the most ' +
      'common thing that happens to one. A closed ticket cannot: closing is the ' +
      'deliberate end, and a queue you can never empty is not a queue.',
  })
  @ApiResponse({ status: 200, type: TicketDto })
  @ApiResponse({ status: 422, description: 'Illegal transition.' })
  status(
    @Param('id') id: string,
    @Body() dto: ChangeTicketStatusDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<TicketDto> {
    return this.changeStatus.execute(id, dto, actor);
  }

  @Patch(':id/assign')
  @RequirePermissions('tickets.assign')
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: 'Assign an agent', description: 'Omit assigneeId to unassign.' })
  @ApiResponse({ status: 200, type: TicketDto })
  assignAgent(@Param('id') id: string, @Body() dto: AssignTicketDto): Promise<TicketDto> {
    return this.assign.execute(id, dto);
  }

  @Patch(':id/priority')
  @RequirePermissions('tickets.update')
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: 'Change the priority' })
  @ApiResponse({ status: 200, type: TicketDto })
  priority(@Param('id') id: string, @Body() dto: ChangeTicketPriorityDto): Promise<TicketDto> {
    return this.changePriority.execute(id, dto);
  }
}

/**
 * What staff have changed, and when.
 *
 * Written by a global interceptor rather than by each feature, so the trail
 * cannot be forgotten — an audit log each module has to remember to write to
 * has holes in exactly the places somebody wanted them.
 */
@ApiTags('Audit Log')
@ApiBearerAuth('access-token')
@ApiResponse({ status: 401, description: 'Not authenticated.', type: ApiErrorResponseDto })
@ApiResponse({ status: 403, description: 'Not permitted.', type: ApiErrorResponseDto })
@Controller('audit-logs')
export class AuditLogController {
  constructor(
    private readonly list: ListAuditLogsUseCase,
    private readonly history: EntityHistoryUseCase,
    private readonly facets: AuditFacetsUseCase,
  ) {}

  @Get()
  @RequirePermissions('audit.read')
  @ApiOperation({
    summary: 'The audit trail',
    description:
      'Every staff mutation, newest first. Filter by actor, action, entity or ' +
      'date. Sensitive fields — passwords, tokens, CNICs, account numbers — are ' +
      'redacted before anything is written, because this log is read by more ' +
      'people and kept for longer than the data it describes.',
  })
  @ApiPaginatedResponse(AuditLogDto)
  entries(@Query() query: ListAuditLogsQueryDto): Promise<PaginatedResult<AuditLogDto>> {
    return this.list.execute(query);
  }

  @Get('entity-types')
  @RequirePermissions('audit.read')
  @ApiOperation({
    summary: 'Entity types present in the log',
    description: 'So a filter can be built from data rather than from a hard-coded list.',
  })
  @ApiResponse({ status: 200, description: 'The distinct entity types recorded.' })
  entityTypes(): Promise<{ entityTypes: string[] }> {
    return this.facets.execute();
  }

  @Get(':entityType/:entityId')
  @RequirePermissions('audit.read')
  @ApiParam({ name: 'entityType', example: 'Coupon' })
  @ApiParam({ name: 'entityId' })
  @ApiOperation({
    summary: 'Everything that happened to one record',
    description:
      'Oldest first, because the history of a record reads as a story. This is ' +
      'the question an audit log exists to answer — "who changed this, and to ' +
      'what" — and answering it by scrolling a chronological feed is how nobody ' +
      'ever uses one.',
  })
  @ApiResponse({ status: 200, type: [AuditLogDto] })
  entityHistory(
    @Param('entityType') entityType: string,
    @Param('entityId') entityId: string,
  ): Promise<AuditLogDto[]> {
    return this.history.execute(entityType, entityId);
  }
}
