import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';

import { ApiPaginatedResponse } from '@/common/decorators/api-paginated-response.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { ApiErrorResponseDto } from '@/common/dto/api-response.dto';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import type { PaginatedResult } from '@/common/interfaces/paginated-result.interface';

import {
  DeviceDto,
  EffectivePreferencesDto,
  NotificationDto,
  UnreadCountDto,
} from './application/dto/notification-response.dto';
import {
  ListNotificationsQueryDto,
  RegisterDeviceDto,
  TestPushDto,
  UnregisterDeviceDto,
} from './application/dto/notification.dto';
import {
  ListDevicesUseCase,
  RegisterDeviceUseCase,
  SendTestPushUseCase,
  UnregisterAllDevicesUseCase,
  UnregisterDeviceUseCase,
} from './application/use-cases/device.use-cases';
import {
  DeleteNotificationUseCase,
  EffectivePreferencesUseCase,
  ListNotificationsUseCase,
  MarkReadUseCase,
  UnreadCountUseCase,
} from './application/use-cases/history.use-cases';

/**
 * A user's own notifications and the devices that receive them.
 *
 * Every route is scoped to the access token — there is no user parameter
 * anywhere here, which is the simplest possible guarantee that one customer
 * cannot read another's messages.
 */
@ApiTags('Notifications')
@ApiBearerAuth('access-token')
@ApiResponse({ status: 401, description: 'Not authenticated.', type: ApiErrorResponseDto })
@ApiResponse({ status: 404, description: 'Not found, or not yours.', type: ApiErrorResponseDto })
@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly list: ListNotificationsUseCase,
    private readonly unread: UnreadCountUseCase,
    private readonly markRead: MarkReadUseCase,
    private readonly remove: DeleteNotificationUseCase,
    private readonly effective: EffectivePreferencesUseCase,
    private readonly registerDevice: RegisterDeviceUseCase,
    private readonly listDevices: ListDevicesUseCase,
    private readonly unregisterDevice: UnregisterDeviceUseCase,
    private readonly unregisterAll: UnregisterAllDevicesUseCase,
    private readonly testPush: SendTestPushUseCase,
  ) {}

  // ── History ────────────────────────────────────────────────

  @Get()
  @ApiOperation({
    summary: 'My notifications',
    description:
      'Newest first. Filter by category, or unreadOnly=true for the badge list. ' +
      'The in-app record exists whether or not a push went out, so nothing is ' +
      'lost when a device is offline.',
  })
  @ApiPaginatedResponse(NotificationDto)
  mine(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: ListNotificationsQueryDto,
  ): Promise<PaginatedResult<NotificationDto>> {
    return this.list.execute(actor, query);
  }

  @Get('unread-count')
  @ApiOperation({
    summary: 'The badge number',
    description: 'Totals only, grouped by category — cheap enough to call on every foreground.',
  })
  @ApiResponse({ status: 200, type: UnreadCountDto })
  unreadCount(@CurrentUser() actor: AuthenticatedUser): Promise<UnreadCountDto> {
    return this.unread.execute(actor);
  }

  @Post('read-all')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark everything as read' })
  @ApiResponse({ status: 200, description: 'How many were marked.' })
  readAll(@CurrentUser() actor: AuthenticatedUser): Promise<{ message: string; updated: number }> {
    return this.markRead.all(actor);
  }

  @Post(':id/read')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'id' })
  @ApiOperation({
    summary: 'Mark one as read',
    description: 'Idempotent — tapping an already-read notification is not an error.',
  })
  @ApiResponse({ status: 200, type: NotificationDto })
  read(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser): Promise<NotificationDto> {
    return this.markRead.one(actor, id);
  }

  @Delete('read')
  @ApiOperation({
    summary: 'Clear what I have read',
    description: 'Unread notifications survive — clearing is tidying, not discarding.',
  })
  @ApiResponse({ status: 200, description: 'How many were cleared.' })
  clearRead(
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<{ message: string; deleted: number }> {
    return this.remove.read(actor);
  }

  @Delete(':id')
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: 'Delete one notification' })
  @ApiResponse({ status: 200, description: 'Removed.' })
  deleteOne(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<{ message: string }> {
    return this.remove.one(actor, id);
  }

  // ── Preferences ────────────────────────────────────────────

  @Get('preferences')
  @ApiOperation({
    summary: 'What would actually reach me right now',
    description:
      'The resolved view, not the stored one. `GET /me/notification-preferences` ' +
      'returns the choices and `PATCH` edits them; this answers the question ' +
      'those cannot — push is switched on, so why is nothing arriving? Usually ' +
      'no registered device, no Firebase credentials on this deployment, or ' +
      'quiet hours.',
  })
  @ApiResponse({ status: 200, type: EffectivePreferencesDto })
  preferences(@CurrentUser() actor: AuthenticatedUser): Promise<EffectivePreferencesDto> {
    return this.effective.execute(actor);
  }

  // ── Devices ────────────────────────────────────────────────

  @Post('devices')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Register this device for push',
    description:
      'Call on every app start, not just the first: Firebase rotates tokens on ' +
      'its own schedule. Supply deviceId and a refreshed token replaces its ' +
      'predecessor rather than leaving a dead registration behind.',
  })
  @ApiResponse({ status: 201, type: DeviceDto })
  register(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: RegisterDeviceDto,
  ): Promise<DeviceDto> {
    return this.registerDevice.execute(actor, dto);
  }

  @Get('devices')
  @ApiOperation({
    summary: 'My registered devices',
    description:
      'Tokens are masked to their last eight characters; the full one is never returned.',
  })
  @ApiResponse({ status: 200, type: [DeviceDto] })
  devices(@CurrentUser() actor: AuthenticatedUser): Promise<DeviceDto[]> {
    return this.listDevices.execute(actor);
  }

  @Post('devices/unregister')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Stop notifications on this device',
    description: 'What an app calls on sign-out.',
  })
  @ApiResponse({ status: 200, description: 'Deregistered.' })
  unregister(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: UnregisterDeviceDto,
  ): Promise<{ message: string }> {
    return this.unregisterDevice.execute(actor, dto);
  }

  @Delete('devices')
  @ApiOperation({ summary: 'Stop notifications on every device' })
  @ApiResponse({ status: 200, description: 'How many were deregistered.' })
  unregisterEverything(
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<{ message: string; devices: number }> {
    return this.unregisterAll.execute(actor);
  }

  @Post('devices/test')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Send myself a test push',
    description:
      'Answers "is it the token, the credentials, the preferences or the phone" ' +
      'without placing a real order to find out.',
  })
  @ApiResponse({ status: 200, description: 'What reached which device.' })
  @ApiResponse({ status: 422, description: 'Push is unconfigured, or no device is registered.' })
  test(@CurrentUser() actor: AuthenticatedUser, @Body() dto: TestPushDto) {
    return this.testPush.execute(actor, dto);
  }
}
