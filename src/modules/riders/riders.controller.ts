import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';

import { ApiPaginatedResponse } from '@/common/decorators/api-paginated-response.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { Roles } from '@/common/decorators/roles.decorator';
import { PaginationQueryDto } from '@/common/dto/pagination-query.dto';
import { ApiErrorResponseDto } from '@/common/dto/api-response.dto';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import type { PaginatedResult } from '@/common/interfaces/paginated-result.interface';

import {
  AssignmentDto,
  DeliveryCodeIssuedDto,
  DeliveryCompletedDto,
  EarningDto,
  EarningsSummaryDto,
  PayoutRequestDto,
  RiderDocumentDto,
  RiderDto,
  RiderWalletDto,
  WalletTransactionDto,
} from './application/dto/rider-response.dto';
import {
  ConfirmDeliveryDto,
  ListAssignmentsQueryDto,
  ListEarningsQueryDto,
  ListPayoutsQueryDto,
  RegisterRiderDto,
  RejectOfferDto,
  RequestPayoutDto,
  SetAvailabilityDto,
  UpdateLocationDto,
  UpdateRiderDto,
  UploadDocumentDto,
} from './application/dto/rider.dto';
import {
  ConfirmDeliveryUseCase,
  GetActiveDeliveryUseCase,
  PickupOrderUseCase,
  StartDeliveryUseCase,
} from './application/use-cases/delivery.use-cases';
import {
  AcceptOfferUseCase,
  ListAssignmentsUseCase,
  RejectOfferUseCase,
} from './application/use-cases/dispatch.use-cases';
import {
  CancelPayoutUseCase,
  EarningsSummaryUseCase,
  GetRiderWalletUseCase,
  ListEarningsUseCase,
  ListPayoutsUseCase,
  ListWalletTransactionsUseCase,
  RequestPayoutUseCase,
} from './application/use-cases/earnings.use-cases';
import { ResubmitApplicationUseCase } from './application/use-cases/rider-approval.use-cases';
import {
  GetMyRiderProfileUseCase,
  ListMyDocumentsUseCase,
  RegisterRiderUseCase,
  SetAvailabilityUseCase,
  UpdateLocationUseCase,
  UpdateRiderProfileUseCase,
  UploadDocumentUseCase,
} from './application/use-cases/rider-profile.use-cases';

/**
 * Everything a rider does from their own app.
 *
 * Every route resolves the rider from the access token rather than from a path
 * parameter, so there is no id a caller could swap to reach another rider's
 * offers, earnings or wallet. Operational routes additionally require an
 * approved account: an applicant can upload documents and watch their status,
 * and nothing else.
 */
@ApiTags('Riders')
@ApiBearerAuth('access-token')
@Roles(UserRole.RIDER, UserRole.ADMIN, UserRole.SUPER_ADMIN)
@ApiResponse({ status: 401, description: 'Not authenticated.', type: ApiErrorResponseDto })
@ApiResponse({ status: 403, description: 'Not an approved rider.', type: ApiErrorResponseDto })
@ApiResponse({ status: 404, description: 'No rider profile.', type: ApiErrorResponseDto })
@Controller('riders')
export class RidersController {
  constructor(
    private readonly register: RegisterRiderUseCase,
    private readonly getProfile: GetMyRiderProfileUseCase,
    private readonly updateProfile: UpdateRiderProfileUseCase,
    private readonly resubmit: ResubmitApplicationUseCase,
    private readonly listDocuments: ListMyDocumentsUseCase,
    private readonly uploadDocument: UploadDocumentUseCase,
    private readonly setAvailability: SetAvailabilityUseCase,
    private readonly updateLocation: UpdateLocationUseCase,
    private readonly listAssignments: ListAssignmentsUseCase,
    private readonly acceptOffer: AcceptOfferUseCase,
    private readonly rejectOffer: RejectOfferUseCase,
    private readonly activeDelivery: GetActiveDeliveryUseCase,
    private readonly pickup: PickupOrderUseCase,
    private readonly startDelivery: StartDeliveryUseCase,
    private readonly confirmDelivery: ConfirmDeliveryUseCase,
    private readonly listEarnings: ListEarningsUseCase,
    private readonly earningsSummary: EarningsSummaryUseCase,
    private readonly wallet: GetRiderWalletUseCase,
    private readonly walletTransactions: ListWalletTransactionsUseCase,
    private readonly requestPayout: RequestPayoutUseCase,
    private readonly listPayouts: ListPayoutsUseCase,
    private readonly cancelPayout: CancelPayoutUseCase,
  ) {}

  // ── Registration and profile ───────────────────────────────

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Register as a rider',
    description:
      'Opens an application in PENDING_APPROVAL — nobody goes on the road on ' +
      'their own say-so. Upload the required documents next; approval follows ' +
      'once a reviewer has verified them.',
  })
  @ApiResponse({ status: 201, type: RiderDto })
  @ApiResponse({ status: 409, description: 'Already registered, or this CNIC is in use.' })
  @ApiResponse({ status: 422, description: 'A motorised vehicle needs its plate number.' })
  create(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: RegisterRiderDto,
  ): Promise<RiderDto> {
    return this.register.execute(actor, dto);
  }

  @Get('me')
  @ApiOperation({
    summary: 'My rider profile',
    description:
      'Includes the outstanding document checklist, so the app can show an ' +
      'applicant exactly what their application is still waiting on.',
  })
  @ApiResponse({ status: 200, type: RiderDto })
  me(@CurrentUser() actor: AuthenticatedUser): Promise<RiderDto> {
    return this.getProfile.execute(actor);
  }

  @Patch('me')
  @ApiOperation({
    summary: 'Update my profile',
    description:
      'Licence number, home zone and payout details. The CNIC is fixed: it is ' +
      'what the approval was made against.',
  })
  @ApiResponse({ status: 200, type: RiderDto })
  update(@CurrentUser() actor: AuthenticatedUser, @Body() dto: UpdateRiderDto): Promise<RiderDto> {
    return this.updateProfile.execute(actor, dto);
  }

  @Post('me/resubmit')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Resubmit a rejected application',
    description: 'Back into the review queue once the rejected documents have been replaced.',
  })
  @ApiResponse({ status: 200, type: RiderDto })
  resubmitApplication(@CurrentUser() actor: AuthenticatedUser): Promise<RiderDto> {
    return this.resubmit.execute(actor);
  }

  // ── Documents ──────────────────────────────────────────────

  @Get('me/documents')
  @ApiOperation({ summary: 'My uploaded documents and their review state' })
  @ApiResponse({ status: 200, type: [RiderDocumentDto] })
  documents(@CurrentUser() actor: AuthenticatedUser): Promise<RiderDocumentDto[]> {
    return this.listDocuments.execute(actor);
  }

  @Put('me/documents')
  @ApiOperation({
    summary: 'Upload or replace a document',
    description:
      'One document per type. Re-uploading replaces the previous file and ' +
      'returns it to the review queue — a rejected document is never quietly ' +
      'resurrected as verified.',
  })
  @ApiResponse({ status: 200, type: RiderDocumentDto })
  @ApiResponse({ status: 422, description: 'The document has already expired.' })
  upload(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: UploadDocumentDto,
  ): Promise<RiderDocumentDto> {
    return this.uploadDocument.execute(actor, dto);
  }

  // ── Availability ───────────────────────────────────────────

  @Patch('me/availability')
  @ApiOperation({
    summary: 'Go online, offline or on break',
    description:
      'Only an approved rider with current documents can go online. Changing ' +
      'availability mid-delivery is refused — finish or hand back the delivery ' +
      'first.',
  })
  @ApiResponse({ status: 200, type: RiderDto })
  @ApiResponse({ status: 422, description: 'Mid-delivery, or a document has expired.' })
  availability(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: SetAvailabilityDto,
  ): Promise<RiderDto> {
    return this.setAvailability.execute(actor, dto);
  }

  @Put('me/location')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Report my current position',
    description:
      'Called every few seconds by the rider app and answers with no body: ' +
      'anything returned here is bandwidth spent on data nobody reads. Feeds ' +
      'dispatch ranking and, later, live tracking.',
  })
  @ApiResponse({ status: 204, description: 'Position recorded.' })
  location(@CurrentUser() actor: AuthenticatedUser, @Body() dto: UpdateLocationDto): Promise<void> {
    return this.updateLocation.execute(actor, dto);
  }

  // ── Offers ─────────────────────────────────────────────────

  @Get('me/offers')
  @ApiOperation({
    summary: 'Deliveries offered to me',
    description:
      'Use liveOnly=true for the inbox — offers still open and unanswered. ' +
      'Customer contact details are withheld until an offer is accepted.',
  })
  @ApiPaginatedResponse(AssignmentDto)
  offers(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: ListAssignmentsQueryDto,
  ): Promise<PaginatedResult<AssignmentDto>> {
    return this.assignmentsFor(actor, query);
  }

  @Post('me/offers/:id/accept')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'id', description: 'Assignment id.' })
  @ApiOperation({
    summary: 'Accept a delivery',
    description:
      'Takes the run: the order gains its rider, competing offers are closed ' +
      'and the customer is told who is bringing their food.',
  })
  @ApiResponse({ status: 200, type: AssignmentDto })
  @ApiResponse({ status: 422, description: 'The offer expired or was already answered.' })
  accept(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser): Promise<AssignmentDto> {
    return this.acceptOffer.execute(id, actor);
  }

  @Post('me/offers/:id/reject')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'id', description: 'Assignment id.' })
  @ApiOperation({
    summary: 'Decline a delivery',
    description:
      'Frees the order for another rider. The rejection is kept, so the ' +
      'dispatcher does not immediately offer you the same run again.',
  })
  @ApiResponse({ status: 200, type: AssignmentDto })
  reject(
    @Param('id') id: string,
    @Body() dto: RejectOfferDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<AssignmentDto> {
    return this.rejectOffer.execute(id, dto, actor);
  }

  // ── Deliveries ─────────────────────────────────────────────

  @Get('me/deliveries/:orderId')
  @ApiParam({ name: 'orderId' })
  @ApiOperation({
    summary: 'The delivery I am carrying',
    description: 'Addresses, contact details and what to collect, in one response.',
  })
  @ApiResponse({ status: 200, type: AssignmentDto })
  delivery(
    @Param('orderId') orderId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<AssignmentDto> {
    return this.activeDelivery.execute(orderId, actor);
  }

  @Post('me/deliveries/:orderId/pickup')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'orderId' })
  @ApiOperation({
    summary: 'Collect the order',
    description:
      'READY_FOR_PICKUP → PICKED_UP, and issues the customer’s four-digit ' +
      'delivery code. The code is sent to the customer and stored only as a ' +
      'hash — it is never returned here.',
  })
  @ApiResponse({ status: 200, type: DeliveryCodeIssuedDto })
  @ApiResponse({ status: 422, description: 'Not accepted yet, or the order is not ready.' })
  collect(
    @Param('orderId') orderId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<DeliveryCodeIssuedDto> {
    return this.pickup.execute(orderId, actor);
  }

  @Post('me/deliveries/:orderId/on-the-way')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'orderId' })
  @ApiOperation({ summary: 'Start the delivery run', description: 'PICKED_UP → ON_THE_WAY.' })
  @ApiResponse({ status: 200, description: 'The customer can now follow your progress.' })
  onTheWay(
    @Param('orderId') orderId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<{ message: string }> {
    return this.startDelivery.execute(orderId, actor);
  }

  @Post('me/deliveries/:orderId/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'orderId' })
  @ApiOperation({
    summary: 'Confirm the delivery with the customer’s code',
    description:
      'ON_THE_WAY → DELIVERED, then credits your wallet with the itemised fare. ' +
      'The code is what makes "delivered" mean something, so this is the only ' +
      'route that can complete a delivery. Five wrong codes burn it and the ' +
      'delivery has to be closed by support.',
  })
  @ApiResponse({ status: 200, type: DeliveryCompletedDto })
  @ApiResponse({ status: 422, description: 'Wrong, expired or already-used code.' })
  confirm(
    @Param('orderId') orderId: string,
    @Body() dto: ConfirmDeliveryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<DeliveryCompletedDto> {
    return this.confirmDelivery.execute(orderId, dto, actor);
  }

  @Get('me/deliveries')
  @ApiOperation({ summary: 'My delivery history' })
  @ApiPaginatedResponse(AssignmentDto)
  deliveries(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: ListAssignmentsQueryDto,
  ): Promise<PaginatedResult<AssignmentDto>> {
    return this.assignmentsFor(actor, query);
  }

  // ── Earnings and wallet ────────────────────────────────────

  @Get('me/earnings')
  @ApiOperation({
    summary: 'My earnings ledger',
    description:
      'Itemised: base fare, distance and tip are separate rows, so how a ' +
      'payment was arrived at is answerable without recomputing history.',
  })
  @ApiPaginatedResponse(EarningDto)
  earnings(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: ListEarningsQueryDto,
  ): Promise<PaginatedResult<EarningDto>> {
    return this.listEarnings.execute(actor, query);
  }

  @Get('me/earnings/summary')
  @ApiOperation({ summary: 'Today, this week and this month at a glance' })
  @ApiResponse({ status: 200, type: EarningsSummaryDto })
  summary(@CurrentUser() actor: AuthenticatedUser): Promise<EarningsSummaryDto> {
    return this.earningsSummary.execute(actor);
  }

  @Get('me/wallet')
  @ApiOperation({
    summary: 'My wallet balance',
    description:
      'Money held against a withdrawal in progress has already left the ' +
      'balance and is reported separately, because riders read "balance" as ' +
      '"what I can take out today".',
  })
  @ApiResponse({ status: 200, type: RiderWalletDto })
  myWallet(@CurrentUser() actor: AuthenticatedUser): Promise<RiderWalletDto> {
    return this.wallet.execute(actor);
  }

  @Get('me/wallet/transactions')
  @ApiOperation({ summary: 'My wallet statement' })
  @ApiPaginatedResponse(WalletTransactionDto)
  statement(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: PaginationQueryDto,
  ): Promise<PaginatedResult<WalletTransactionDto>> {
    return this.walletTransactions.execute(actor, query.page, query.limit);
  }

  // ── Withdrawals ────────────────────────────────────────────

  @Post('me/withdrawals')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Request a withdrawal',
    description:
      'The amount leaves your wallet immediately and is held until an operator ' +
      'processes it, so it cannot be spent twice. One request at a time; ' +
      'cancelling or a rejection returns the money.',
  })
  @ApiResponse({ status: 201, type: PayoutRequestDto })
  @ApiResponse({
    status: 422,
    description: 'Below the minimum, more than the balance, or one is already in flight.',
  })
  withdraw(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: RequestPayoutDto,
  ): Promise<PayoutRequestDto> {
    return this.requestPayout.execute(actor, dto);
  }

  @Get('me/withdrawals')
  @ApiOperation({ summary: 'My withdrawal history' })
  @ApiPaginatedResponse(PayoutRequestDto)
  withdrawals(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: ListPayoutsQueryDto,
  ): Promise<PaginatedResult<PayoutRequestDto>> {
    return this.listPayouts.mine(actor, query);
  }

  @Post('me/withdrawals/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'id' })
  @ApiOperation({
    summary: 'Cancel a withdrawal I requested',
    description: 'Only while it is still pending. The held money goes straight back.',
  })
  @ApiResponse({ status: 200, type: PayoutRequestDto })
  cancelWithdrawal(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<PayoutRequestDto> {
    return this.cancelPayout.execute(id, actor);
  }

  /** Offers and history are the same query, scoped to the calling rider. */
  private async assignmentsFor(
    actor: AuthenticatedUser,
    query: ListAssignmentsQueryDto,
  ): Promise<PaginatedResult<AssignmentDto>> {
    const rider = await this.getProfile.execute(actor);

    return this.listAssignments.execute(query, { driverId: rider.id });
  }
}
