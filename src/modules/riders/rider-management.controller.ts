import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';

import { ApiPaginatedResponse } from '@/common/decorators/api-paginated-response.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { RequirePermissions } from '@/common/decorators/permissions.decorator';
import { ApiErrorResponseDto } from '@/common/dto/api-response.dto';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import type { PaginatedResult } from '@/common/interfaces/paginated-result.interface';

import {
  AssignmentDto,
  PayoutRequestDto,
  RiderDocumentDto,
  RiderDto,
} from './application/dto/rider-response.dto';
import {
  AssignOrderDto,
  CancelAssignmentDto,
  ListAssignmentsQueryDto,
  ListPayoutsQueryDto,
  ListRidersQueryDto,
  MarkPayoutPaidDto,
  RejectDocumentDto,
  RejectPayoutDto,
  RejectRiderDto,
  SuspendRiderDto,
} from './application/dto/rider.dto';
import {
  AssignOrderUseCase,
  CancelAssignmentUseCase,
  ExpireOffersUseCase,
  ListAssignmentsUseCase,
} from './application/use-cases/dispatch.use-cases';
import {
  ListPayoutsUseCase,
  ProcessPayoutUseCase,
} from './application/use-cases/earnings.use-cases';
import {
  ApproveRiderUseCase,
  GetRiderUseCase,
  ListRiderDocumentsUseCase,
  ListRidersUseCase,
  ReinstateRiderUseCase,
  RejectRiderUseCase,
  ReviewDocumentUseCase,
  SuspendRiderUseCase,
} from './application/use-cases/rider-approval.use-cases';

/**
 * The operator side of the rider module: the approval queue, the dispatch
 * board and the withdrawal queue.
 *
 * Guarded by permission rather than by role, so a dispatcher can be given
 * `orders.assign` without also being handed the ability to approve riders or
 * move their money.
 */
@ApiTags('Rider Management')
@ApiBearerAuth('access-token')
@ApiResponse({ status: 401, description: 'Not authenticated.', type: ApiErrorResponseDto })
@ApiResponse({ status: 403, description: 'Not permitted.', type: ApiErrorResponseDto })
@ApiResponse({ status: 404, description: 'Not found.', type: ApiErrorResponseDto })
@Controller('rider-management')
export class RiderManagementController {
  constructor(
    private readonly listRiders: ListRidersUseCase,
    private readonly getRider: GetRiderUseCase,
    private readonly approve: ApproveRiderUseCase,
    private readonly reject: RejectRiderUseCase,
    private readonly suspend: SuspendRiderUseCase,
    private readonly reinstate: ReinstateRiderUseCase,
    private readonly listDocuments: ListRiderDocumentsUseCase,
    private readonly reviewDocument: ReviewDocumentUseCase,
    private readonly assign: AssignOrderUseCase,
    private readonly listAssignments: ListAssignmentsUseCase,
    private readonly cancelAssignment: CancelAssignmentUseCase,
    private readonly expireOffers: ExpireOffersUseCase,
    private readonly listPayouts: ListPayoutsUseCase,
    private readonly processPayout: ProcessPayoutUseCase,
  ) {}

  // ── Roster and approval queue ──────────────────────────────

  @Get('riders')
  @RequirePermissions('drivers.read')
  @ApiOperation({
    summary: 'List riders',
    description:
      'Filter by status=PENDING_APPROVAL to work the approval queue, or by ' +
      'availability=ONLINE to see who is working right now.',
  })
  @ApiPaginatedResponse(RiderDto)
  riders(@Query() query: ListRidersQueryDto): Promise<PaginatedResult<RiderDto>> {
    return this.listRiders.execute(query);
  }

  @Get('riders/:id')
  @RequirePermissions('drivers.read')
  @ApiParam({ name: 'id' })
  @ApiOperation({
    summary: 'Get a rider',
    description: 'Includes the document checklist the approval decision rests on.',
  })
  @ApiResponse({ status: 200, type: RiderDto })
  rider(@Param('id') id: string): Promise<RiderDto> {
    return this.getRider.execute(id);
  }

  @Post('riders/:id/approve')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('drivers.approve')
  @ApiParam({ name: 'id' })
  @ApiOperation({
    summary: 'Approve a rider',
    description:
      'Blocked until every required document is verified and current. ' +
      'Approving around a missing CNIC would put an unidentified person on a ' +
      'customer’s doorstep with their food and their cash.',
  })
  @ApiResponse({ status: 200, type: RiderDto })
  @ApiResponse({ status: 422, description: 'Illegal transition, or documents outstanding.' })
  approveRider(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<RiderDto> {
    return this.approve.execute(id, actor);
  }

  @Post('riders/:id/reject')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('drivers.approve')
  @ApiParam({ name: 'id' })
  @ApiOperation({
    summary: 'Reject an application',
    description: 'The reason is shown to the rider, so a rejection is not a dead end.',
  })
  @ApiResponse({ status: 200, type: RiderDto })
  rejectRider(
    @Param('id') id: string,
    @Body() dto: RejectRiderDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<RiderDto> {
    return this.reject.execute(id, dto, actor);
  }

  @Post('riders/:id/suspend')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('drivers.suspend')
  @ApiParam({ name: 'id' })
  @ApiOperation({
    summary: 'Suspend a rider',
    description:
      'Takes them off the road and offline immediately. Refused mid-delivery: ' +
      'reassign the order first, or the food is stranded.',
  })
  @ApiResponse({ status: 200, type: RiderDto })
  @ApiResponse({ status: 422, description: 'The rider is currently carrying an order.' })
  suspendRider(
    @Param('id') id: string,
    @Body() dto: SuspendRiderDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<RiderDto> {
    return this.suspend.execute(id, dto, actor);
  }

  @Post('riders/:id/reinstate')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('drivers.suspend')
  @ApiParam({ name: 'id' })
  @ApiOperation({
    summary: 'Lift a suspension',
    description: 'Documents are re-checked, since a licence may have lapsed in the meantime.',
  })
  @ApiResponse({ status: 200, type: RiderDto })
  reinstateRider(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<RiderDto> {
    return this.reinstate.execute(id, actor);
  }

  // ── Document review ────────────────────────────────────────

  @Get('riders/:id/documents')
  @RequirePermissions('drivers.read')
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: 'Documents filed by a rider' })
  @ApiResponse({ status: 200, type: [RiderDocumentDto] })
  documents(@Param('id') id: string): Promise<RiderDocumentDto[]> {
    return this.listDocuments.execute(id);
  }

  @Post('documents/:documentId/verify')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('drivers.approve')
  @ApiParam({ name: 'documentId' })
  @ApiOperation({
    summary: 'Verify a document',
    description:
      'One document at a time, deliberately: a reviewer who can only approve ' +
      'the whole set at once ends up approving documents they did not look at.',
  })
  @ApiResponse({ status: 200, type: RiderDocumentDto })
  @ApiResponse({ status: 422, description: 'The document has expired.' })
  verify(
    @Param('documentId') documentId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<RiderDocumentDto> {
    return this.reviewDocument.verify(documentId, actor);
  }

  @Post('documents/:documentId/reject')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('drivers.approve')
  @ApiParam({ name: 'documentId' })
  @ApiOperation({
    summary: 'Reject a document',
    description: 'The reason tells the rider exactly what to re-upload.',
  })
  @ApiResponse({ status: 200, type: RiderDocumentDto })
  rejectDocument(
    @Param('documentId') documentId: string,
    @Body() dto: RejectDocumentDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<RiderDocumentDto> {
    return this.reviewDocument.reject(documentId, dto, actor);
  }

  // ── Dispatch board ─────────────────────────────────────────

  @Post('orders/:orderId/assign')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('orders.assign')
  @ApiParam({ name: 'orderId' })
  @ApiOperation({
    summary: 'Offer an order to a rider',
    description:
      'Name a rider, or omit driverId to let the dispatcher pick the nearest ' +
      'online rider with no delivery in hand. The result is an offer, not an ' +
      'assignment — the rider still has to accept it, and an order pushed onto ' +
      'a rider who has gone home only looks handled. Dispatch may start as ' +
      'soon as the restaurant confirms, so a rider can ride while the food cooks.',
  })
  @ApiResponse({ status: 201, type: AssignmentDto })
  @ApiResponse({
    status: 422,
    description: 'Order not dispatchable, already assigned, or no rider available.',
  })
  assignOrder(
    @Param('orderId') orderId: string,
    @Body() dto: AssignOrderDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<AssignmentDto> {
    return this.assign.execute(orderId, dto, actor);
  }

  @Get('assignments')
  @RequirePermissions('orders.read')
  @ApiOperation({
    summary: 'The dispatch board',
    description: 'Every offer and delivery, across all riders.',
  })
  @ApiPaginatedResponse(AssignmentDto)
  assignments(@Query() query: ListAssignmentsQueryDto): Promise<PaginatedResult<AssignmentDto>> {
    return this.listAssignments.execute(query);
  }

  @Get('riders/:id/assignments')
  @RequirePermissions('orders.read')
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: 'One rider’s offers and deliveries' })
  @ApiPaginatedResponse(AssignmentDto)
  riderAssignments(
    @Param('id') id: string,
    @Query() query: ListAssignmentsQueryDto,
  ): Promise<PaginatedResult<AssignmentDto>> {
    return this.listAssignments.execute(query, { driverId: id });
  }

  @Post('assignments/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('orders.assign')
  @ApiParam({ name: 'id' })
  @ApiOperation({
    summary: 'Withdraw an assignment',
    description:
      'Frees the order for re-dispatch and puts the rider back in the pool. ' +
      'Refused once the rider is carrying the food — mark the delivery failed ' +
      'instead of quietly detaching it.',
  })
  @ApiResponse({ status: 200, type: AssignmentDto })
  @ApiResponse({ status: 422, description: 'Already answered, or the order is already collected.' })
  cancel(@Param('id') id: string, @Body() dto: CancelAssignmentDto): Promise<AssignmentDto> {
    return this.cancelAssignment.execute(id, dto);
  }

  @Post('assignments/expire')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('orders.assign')
  @ApiOperation({
    summary: 'Sweep up unanswered offers',
    description:
      'Marks offers past their deadline as EXPIRED. Housekeeping only — the ' +
      'acceptance path re-checks the deadline itself, so a late sweep can ' +
      'never let an expired offer through.',
  })
  @ApiResponse({ status: 200, description: 'Number of offers expired.' })
  expire(): Promise<{ expired: number }> {
    return this.expireOffers.execute();
  }

  // ── Withdrawal queue ───────────────────────────────────────

  @Get('withdrawals')
  @RequirePermissions('payouts.read')
  @ApiOperation({
    summary: 'The withdrawal queue',
    description: 'Filter by status=PENDING for requests waiting on a decision.',
  })
  @ApiPaginatedResponse(PayoutRequestDto)
  withdrawals(@Query() query: ListPayoutsQueryDto): Promise<PaginatedResult<PayoutRequestDto>> {
    return this.listPayouts.all(query);
  }

  @Post('withdrawals/:id/approve')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('payouts.approve')
  @ApiParam({ name: 'id' })
  @ApiOperation({
    summary: 'Approve a withdrawal',
    description:
      'Clears it for payment. Approval and payment are separate steps because ' +
      'they happen at different times and by different hands — collapsing them ' +
      'would record money as sent before anyone sent it.',
  })
  @ApiResponse({ status: 200, type: PayoutRequestDto })
  approveWithdrawal(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<PayoutRequestDto> {
    return this.processPayout.approve(id, actor);
  }

  @Post('withdrawals/:id/paid')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('payouts.approve')
  @ApiParam({ name: 'id' })
  @ApiOperation({
    summary: 'Mark a withdrawal paid',
    description:
      'Records that the transfer actually happened, with its bank reference. ' +
      'No money moves here — the wallet was debited when the request was made.',
  })
  @ApiResponse({ status: 200, type: PayoutRequestDto })
  markPaid(
    @Param('id') id: string,
    @Body() dto: MarkPayoutPaidDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<PayoutRequestDto> {
    return this.processPayout.markPaid(id, dto, actor);
  }

  @Post('withdrawals/:id/reject')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('payouts.approve')
  @ApiParam({ name: 'id' })
  @ApiOperation({
    summary: 'Reject a withdrawal',
    description: 'Returns the held money to the rider’s wallet and records why.',
  })
  @ApiResponse({ status: 200, type: PayoutRequestDto })
  rejectWithdrawal(
    @Param('id') id: string,
    @Body() dto: RejectPayoutDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<PayoutRequestDto> {
    return this.processPayout.reject(id, dto, actor);
  }
}
