import {
  Body,
  Controller,
  Delete,
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
import { RequirePermissions } from '@/common/decorators/permissions.decorator';
import { Roles } from '@/common/decorators/roles.decorator';
import { ApiErrorResponseDto } from '@/common/dto/api-response.dto';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import type { PaginatedResult } from '@/common/interfaces/paginated-result.interface';

import { MessageResponseDto } from '../auth/application/dto/auth-response.dto';
import { ListRestaurantsAdminQueryDto } from './application/dto/restaurant-query.dto';
import {
  BusinessHourResponseDto,
  RestaurantAdminDto,
  RestaurantImageDto,
} from './application/dto/restaurant-response.dto';
import {
  AddRestaurantImageDto,
  ChangeRestaurantStatusDto,
  RegisterRestaurantDto,
  RejectRestaurantDto,
  ReorderImagesDto,
  SetAcceptingOrdersDto,
  SetBusinessHoursDto,
  UpdateRestaurantDto,
} from './application/dto/restaurant.dto';
import {
  RegisterRestaurantStaffDto,
  RestaurantStaffDto,
} from './application/dto/restaurant-staff.dto';
import {
  ListRestaurantStaffUseCase,
  RegisterRestaurantStaffUseCase,
} from './application/use-cases/staff.use-cases';
import {
  ApproveRestaurantUseCase,
  ChangeRestaurantStatusUseCase,
  RejectRestaurantUseCase,
  ResubmitRestaurantUseCase,
  SetAcceptingOrdersUseCase,
} from './application/use-cases/approval.use-cases';
import {
  AddRestaurantImageUseCase,
  DeleteRestaurantImageUseCase,
  ReorderRestaurantImagesUseCase,
  SetBusinessHoursUseCase,
} from './application/use-cases/hours-images.use-cases';
import {
  DeleteRestaurantUseCase,
  GetRestaurantUseCase,
  ListRestaurantsAdminUseCase,
  RegisterRestaurantUseCase,
  UpdateRestaurantUseCase,
} from './application/use-cases/restaurants.use-cases';

/**
 * Owner and staff management.
 *
 * Ownership is enforced inside the use-cases rather than by the route, because
 * the same endpoint serves both a vendor editing their own listing and an
 * administrator editing anyone's.
 */
@ApiTags('Restaurant Management')
@ApiBearerAuth('access-token')
@ApiResponse({ status: 401, description: 'Not authenticated.', type: ApiErrorResponseDto })
@ApiResponse({ status: 403, description: 'Not permitted.', type: ApiErrorResponseDto })
@Controller('restaurant-management')
export class RestaurantManagementController {
  constructor(
    private readonly register: RegisterRestaurantUseCase,
    private readonly listAdmin: ListRestaurantsAdminUseCase,
    private readonly getRestaurant: GetRestaurantUseCase,
    private readonly updateRestaurant: UpdateRestaurantUseCase,
    private readonly deleteRestaurant: DeleteRestaurantUseCase,
    private readonly approve: ApproveRestaurantUseCase,
    private readonly reject: RejectRestaurantUseCase,
    private readonly resubmit: ResubmitRestaurantUseCase,
    private readonly changeStatus: ChangeRestaurantStatusUseCase,
    private readonly setAccepting: SetAcceptingOrdersUseCase,
    private readonly setHours: SetBusinessHoursUseCase,
    private readonly addImage: AddRestaurantImageUseCase,
    private readonly deleteImage: DeleteRestaurantImageUseCase,
    private readonly reorderImages: ReorderRestaurantImagesUseCase,
    private readonly registerStaff: RegisterRestaurantStaffUseCase,
    private readonly listStaff: ListRestaurantStaffUseCase,
  ) {}

  // ── Registration and CRUD ──────────────────────────────────

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Roles(UserRole.VENDOR_OWNER, UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Register a restaurant',
    description:
      'Creates the listing in PENDING_APPROVAL — nothing goes live on its own. ' +
      'The city and delivery zone are resolved from the coordinates, and the ' +
      'slug is generated from the name, disambiguated by zone if needed.',
  })
  @ApiResponse({ status: 201, type: RestaurantAdminDto })
  @ApiResponse({ status: 422, description: 'Outside the service area, or bad category ids.' })
  create(
    @CurrentUser('id') ownerId: string,
    @Body() dto: RegisterRestaurantDto,
  ): Promise<RestaurantAdminDto> {
    return this.register.execute(ownerId, dto);
  }

  @Get('mine')
  @Roles(UserRole.VENDOR_OWNER)
  @ApiOperation({
    summary: 'List my restaurants',
    description: 'Scoped to the caller regardless of any ownerId in the query.',
  })
  @ApiPaginatedResponse(RestaurantAdminDto)
  mine(
    @CurrentUser('id') ownerId: string,
    @Query() query: ListRestaurantsAdminQueryDto,
  ): Promise<PaginatedResult<RestaurantAdminDto>> {
    return this.listAdmin.execute(query, ownerId);
  }

  @Get()
  @RequirePermissions('restaurants.read')
  @ApiOperation({
    summary: 'List all restaurants',
    description:
      'Staff view across every status, including pending and rejected listings. ' +
      'Filter by status=PENDING_APPROVAL to work the approval queue.',
  })
  @ApiPaginatedResponse(RestaurantAdminDto)
  list(@Query() query: ListRestaurantsAdminQueryDto): Promise<PaginatedResult<RestaurantAdminDto>> {
    return this.listAdmin.execute(query);
  }

  @Get(':id')
  @ApiParam({ name: 'id' })
  @ApiOperation({
    summary: 'Get a restaurant with its private fields',
    description: 'The only path that can see a listing which is not yet approved.',
  })
  @ApiResponse({ status: 200, type: RestaurantAdminDto })
  detail(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<RestaurantAdminDto> {
    return this.getRestaurant.byId(id, actor);
  }

  @Patch(':id')
  @ApiParam({ name: 'id' })
  @ApiOperation({
    summary: 'Update a restaurant',
    description: 'Moving the coordinates re-resolves the city and delivery zone.',
  })
  @ApiResponse({ status: 200, type: RestaurantAdminDto })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateRestaurantDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<RestaurantAdminDto> {
    return this.updateRestaurant.execute(id, dto, actor);
  }

  @Delete(':id')
  @ApiParam({ name: 'id' })
  @ApiOperation({
    summary: 'Remove a restaurant',
    description: 'Soft delete, so past orders and reviews keep resolving.',
  })
  @ApiResponse({ status: 200, type: MessageResponseDto })
  remove(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<MessageResponseDto> {
    return this.deleteRestaurant.execute(id, actor);
  }

  // ── Approval workflow ──────────────────────────────────────

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('restaurants.approve')
  @ApiParam({ name: 'id' })
  @ApiOperation({
    summary: 'Approve a pending restaurant',
    description:
      'Takes the listing live and turns ordering on. Blocked until business ' +
      'hours are set, since a restaurant with none would be permanently closed.',
  })
  @ApiResponse({ status: 200, type: RestaurantAdminDto })
  @ApiResponse({ status: 422, description: 'Illegal transition, or hours not yet set.' })
  approveRestaurant(
    @Param('id') id: string,
    @CurrentUser('id') reviewerId: string,
  ): Promise<RestaurantAdminDto> {
    return this.approve.execute(id, reviewerId);
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('restaurants.approve')
  @ApiParam({ name: 'id' })
  @ApiOperation({
    summary: 'Reject a pending restaurant',
    description: 'The reason is shown to the owner so the rejection is actionable.',
  })
  @ApiResponse({ status: 200, type: RestaurantAdminDto })
  rejectRestaurant(
    @Param('id') id: string,
    @Body() dto: RejectRestaurantDto,
    @CurrentUser('id') reviewerId: string,
  ): Promise<RestaurantAdminDto> {
    return this.reject.execute(id, dto, reviewerId);
  }

  @Post(':id/resubmit')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'id' })
  @ApiOperation({
    summary: 'Resubmit a rejected restaurant for review',
    description: 'Owner action. A rejected listing never goes live without a second review.',
  })
  @ApiResponse({ status: 200, type: RestaurantAdminDto })
  resubmitRestaurant(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<RestaurantAdminDto> {
    return this.resubmit.execute(id, actor);
  }

  @Patch(':id/status')
  @RequirePermissions('restaurants.suspend')
  @ApiParam({ name: 'id' })
  @ApiOperation({
    summary: 'Change status directly',
    description:
      'Staff override for suspension, reinstatement and temporary closure. ' +
      'Illegal transitions are rejected — see the approval state machine.',
  })
  @ApiResponse({ status: 200, type: RestaurantAdminDto })
  setStatus(
    @Param('id') id: string,
    @Body() dto: ChangeRestaurantStatusDto,
    @CurrentUser('id') reviewerId: string,
  ): Promise<RestaurantAdminDto> {
    return this.changeStatus.execute(id, dto, reviewerId);
  }

  @Patch(':id/accepting-orders')
  @ApiParam({ name: 'id' })
  @ApiOperation({
    summary: 'Pause or resume incoming orders',
    description:
      "The owner's own switch, independent of opening hours and of the approval " +
      'trail — for a broken oven or an unexpected rush.',
  })
  @ApiResponse({ status: 200, type: RestaurantAdminDto })
  acceptingOrders(
    @Param('id') id: string,
    @Body() dto: SetAcceptingOrdersDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<RestaurantAdminDto> {
    return this.setAccepting.execute(id, dto, actor);
  }

  // ── Business hours ─────────────────────────────────────────

  @Put(':id/hours')
  @ApiParam({ name: 'id' })
  @ApiOperation({
    summary: 'Set business hours',
    description:
      'Replaces the whole week: days omitted from the request are stored as ' +
      'closed, so no stale row survives a save. A closing time at or before the ' +
      'opening time means the window runs past midnight.',
  })
  @ApiResponse({ status: 200, type: [BusinessHourResponseDto] })
  @ApiResponse({ status: 422, description: 'Duplicate day, or identical open and close times.' })
  hours(
    @Param('id') id: string,
    @Body() dto: SetBusinessHoursDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<BusinessHourResponseDto[]> {
    return this.setHours.execute(id, dto, actor);
  }

  // ── Images ─────────────────────────────────────────────────

  @Post(':id/images')
  @HttpCode(HttpStatus.CREATED)
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: 'Add a gallery image' })
  @ApiResponse({ status: 201, type: RestaurantImageDto })
  @ApiResponse({ status: 422, description: 'Image limit reached.' })
  image(
    @Param('id') id: string,
    @Body() dto: AddRestaurantImageDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<RestaurantImageDto> {
    return this.addImage.execute(id, dto, actor);
  }

  @Put(':id/images/order')
  @ApiParam({ name: 'id' })
  @ApiOperation({
    summary: 'Reorder the gallery',
    description: 'Every image id must be listed, so no image is left in a stale position.',
  })
  @ApiResponse({ status: 200, type: [RestaurantImageDto] })
  reorder(
    @Param('id') id: string,
    @Body() dto: ReorderImagesDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<RestaurantImageDto[]> {
    return this.reorderImages.execute(id, dto, actor);
  }

  @Delete(':id/images/:imageId')
  @ApiParam({ name: 'id' })
  @ApiParam({ name: 'imageId' })
  @ApiOperation({ summary: 'Delete a gallery image' })
  @ApiResponse({ status: 200, type: MessageResponseDto })
  removeImage(
    @Param('id') id: string,
    @Param('imageId') imageId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<MessageResponseDto> {
    return this.deleteImage.execute(id, imageId, actor);
  }

  // ── Staff ──────────────────────────────────────────────────

  @Post(':id/staff')
  @HttpCode(HttpStatus.CREATED)
  @ApiParam({ name: 'id' })
  @ApiOperation({
    summary: 'Register a staff account for this restaurant',
    description:
      'Owner action. Creates a VENDOR_STAFF account that can manage only this ' +
      'restaurant — the kitchen order queue, menu and profile — never any ' +
      "other vendor's listing.",
  })
  @ApiResponse({ status: 201, type: RestaurantStaffDto })
  @ApiResponse({ status: 409, description: 'Phone or email already registered.' })
  addStaff(
    @Param('id') id: string,
    @Body() dto: RegisterRestaurantStaffDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<RestaurantStaffDto> {
    return this.registerStaff.execute(id, dto, actor);
  }

  @Get(':id/staff')
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: "List this restaurant's staff accounts" })
  @ApiResponse({ status: 200, type: [RestaurantStaffDto] })
  staff(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<RestaurantStaffDto[]> {
    return this.listStaff.execute(id, actor);
  }
}
