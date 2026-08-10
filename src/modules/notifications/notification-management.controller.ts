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

import { ApiPaginatedResponse } from '@/common/decorators/api-paginated-response.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { RequirePermissions } from '@/common/decorators/permissions.decorator';
import { ApiErrorResponseDto } from '@/common/dto/api-response.dto';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import type { PaginatedResult } from '@/common/interfaces/paginated-result.interface';

import {
  BroadcastDto,
  BroadcastPreviewDto,
  SendResultDto,
} from './application/dto/notification-response.dto';
import {
  CreateBroadcastDto,
  ListBroadcastsQueryDto,
  SendNotificationDto,
  UpdateBroadcastDto,
} from './application/dto/notification.dto';
import {
  CancelBroadcastUseCase,
  CreateBroadcastUseCase,
  DispatchScheduledBroadcastsUseCase,
  GetBroadcastUseCase,
  ListBroadcastsUseCase,
  PreviewAudienceUseCase,
  SendBroadcastUseCase,
  SendDirectNotificationUseCase,
  UpdateBroadcastUseCase,
} from './application/use-cases/broadcast.use-cases';

/**
 * Campaigns and operator-sent messages.
 *
 * A broadcast is the one action in this platform that reaches every customer at
 * once, so the flow is deliberately three steps — compose, preview the
 * audience, send — rather than one button that does all three.
 */
@ApiTags('Notification Management')
@ApiBearerAuth('access-token')
@ApiResponse({ status: 401, description: 'Not authenticated.', type: ApiErrorResponseDto })
@ApiResponse({ status: 403, description: 'Not permitted.', type: ApiErrorResponseDto })
@ApiResponse({ status: 404, description: 'Not found.', type: ApiErrorResponseDto })
@Controller('notification-management')
export class NotificationManagementController {
  constructor(
    private readonly create: CreateBroadcastUseCase,
    private readonly update: UpdateBroadcastUseCase,
    private readonly list: ListBroadcastsUseCase,
    private readonly get: GetBroadcastUseCase,
    private readonly preview: PreviewAudienceUseCase,
    private readonly send: SendBroadcastUseCase,
    private readonly cancel: CancelBroadcastUseCase,
    private readonly dispatchDue: DispatchScheduledBroadcastsUseCase,
    private readonly direct: SendDirectNotificationUseCase,
  ) {}

  // ── Campaigns ──────────────────────────────────────────────

  @Post('broadcasts')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('notifications.create')
  @ApiOperation({
    summary: 'Compose a campaign',
    description:
      'Saved as a draft unless scheduledFor is given — sending is a separate, ' +
      'deliberate act, because the difference between a good campaign and an ' +
      'incident is usually a proofread. A narrowed audience must carry the ' +
      'thing that narrows it: ROLE without a role would be everybody.',
  })
  @ApiResponse({ status: 201, type: BroadcastDto })
  @ApiResponse({ status: 422, description: 'Incomplete audience, or a schedule in the past.' })
  compose(
    @Body() dto: CreateBroadcastDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<BroadcastDto> {
    return this.create.execute(dto, actor);
  }

  @Get('broadcasts')
  @RequirePermissions('notifications.read')
  @ApiOperation({ summary: 'List campaigns', description: 'Filter by status or date.' })
  @ApiPaginatedResponse(BroadcastDto)
  broadcasts(@Query() query: ListBroadcastsQueryDto): Promise<PaginatedResult<BroadcastDto>> {
    return this.list.execute(query);
  }

  @Get('broadcasts/:id')
  @RequirePermissions('notifications.read')
  @ApiParam({ name: 'id' })
  @ApiOperation({
    summary: 'Get a campaign',
    description: 'Includes the running delivery counts while a send is in progress.',
  })
  @ApiResponse({ status: 200, type: BroadcastDto })
  broadcast(@Param('id') id: string): Promise<BroadcastDto> {
    return this.get.execute(id);
  }

  @Patch('broadcasts/:id')
  @RequirePermissions('notifications.create')
  @ApiParam({ name: 'id' })
  @ApiOperation({
    summary: 'Edit a campaign',
    description: 'Only while it is still a draft or scheduled.',
  })
  @ApiResponse({ status: 200, type: BroadcastDto })
  edit(@Param('id') id: string, @Body() dto: UpdateBroadcastDto): Promise<BroadcastDto> {
    return this.update.execute(id, dto);
  }

  @Get('broadcasts/:id/preview')
  @RequirePermissions('notifications.read')
  @ApiParam({ name: 'id' })
  @ApiOperation({
    summary: 'How many people this would reach',
    description:
      'Nobody should discover the size of an audience by sending to it. ' +
      '"ALL" reads exactly the same in a form as a narrow role filter does.',
  })
  @ApiResponse({ status: 200, type: BroadcastPreviewDto })
  audiencePreview(@Param('id') id: string): Promise<BroadcastPreviewDto> {
    return this.preview.execute(id);
  }

  @Post('broadcasts/:id/send')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('notifications.send')
  @ApiParam({ name: 'id' })
  @ApiOperation({
    summary: 'Send a campaign now',
    description:
      'Fans out in batches, writing the delivery counts back as it goes. Each ' +
      'recipient’s own preferences are applied — a customer who muted ' +
      'promotions is counted as skipped, not failed. Promotional pushes are ' +
      'held back between 22:00 and 08:00; order, wallet and support messages ' +
      'are not.',
  })
  @ApiResponse({ status: 200, type: SendResultDto })
  @ApiResponse({ status: 422, description: 'Already sent, cancelled or in progress.' })
  dispatch(@Param('id') id: string): Promise<SendResultDto> {
    return this.send.execute(id);
  }

  @Post('broadcasts/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('notifications.create')
  @ApiParam({ name: 'id' })
  @ApiOperation({
    summary: 'Cancel a campaign',
    description: 'Only before it starts sending. A message already delivered cannot be recalled.',
  })
  @ApiResponse({ status: 200, type: BroadcastDto })
  stop(@Param('id') id: string): Promise<BroadcastDto> {
    return this.cancel.execute(id);
  }

  @Post('broadcasts/dispatch-due')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('notifications.send')
  @ApiOperation({
    summary: 'Send whatever is scheduled and due',
    description:
      'A sweep rather than a timer per campaign: a scheduled send that only ' +
      'happens if the process was running at that exact minute is not ' +
      'scheduling. This also recovers whatever a restart missed.',
  })
  @ApiResponse({ status: 200, description: 'How many campaigns were sent.' })
  runDue(): Promise<{ sent: number }> {
    return this.dispatchDue.execute();
  }

  // ── One-off messages ───────────────────────────────────────

  @Post('notify')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('notifications.send')
  @ApiOperation({
    summary: 'Notify one user',
    description:
      'The support desk’s "let them know" button. Goes through the same ' +
      'preference check as everything else — an agent cannot push to somebody ' +
      'who turned pushes off, however good the reason feels at the time.',
  })
  @ApiResponse({ status: 200, type: SendResultDto })
  notifyOne(@Body() dto: SendNotificationDto): Promise<SendResultDto> {
    return this.direct.execute(dto);
  }
}
