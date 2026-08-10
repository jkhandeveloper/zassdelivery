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
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { ApiPaginatedResponse } from '@/common/decorators/api-paginated-response.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { RequirePermissions } from '@/common/decorators/permissions.decorator';
import { Public } from '@/common/decorators/public.decorator';
import { ApiErrorResponseDto } from '@/common/dto/api-response.dto';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import type { PaginatedResult } from '@/common/interfaces/paginated-result.interface';

import {
  BannerDto,
  CouponDto,
  SettingDto,
  SettingGroupDto,
} from './application/dto/admin-response.dto';
import {
  CreateBannerDto,
  CreateCouponDto,
  ListBannersQueryDto,
  ListCouponsQueryDto,
  ReorderBannersDto,
  UpdateBannerDto,
  UpdateCouponDto,
  UpsertSettingsDto,
} from './application/dto/admin.dto';
import {
  CreateBannerUseCase,
  CreateCouponUseCase,
  DeleteBannerUseCase,
  DeleteCouponUseCase,
  DeleteSettingUseCase,
  GetCouponUseCase,
  ListBannersUseCase,
  ListCouponsUseCase,
  ListSettingsUseCase,
  ReorderBannersUseCase,
  SetCouponActiveUseCase,
  UpdateBannerUseCase,
  UpdateCouponUseCase,
  UpsertSettingsUseCase,
} from './application/use-cases/content.use-cases';

/**
 * Promotions, artwork and platform configuration.
 *
 * Each resource has a public read and a permissioned write, because all three
 * are things customers see: a coupon nobody can discover is a coupon nobody
 * redeems, and a settings screen that cannot read `platform.min_order_amount`
 * hard-codes it instead.
 */
@ApiTags('Admin Content')
@ApiBearerAuth('access-token')
@ApiResponse({ status: 403, description: 'Not permitted.', type: ApiErrorResponseDto })
@ApiResponse({ status: 404, description: 'Not found.', type: ApiErrorResponseDto })
@Controller()
export class AdminContentController {
  constructor(
    private readonly listCoupons: ListCouponsUseCase,
    private readonly getCoupon: GetCouponUseCase,
    private readonly createCoupon: CreateCouponUseCase,
    private readonly updateCoupon: UpdateCouponUseCase,
    private readonly setCouponActive: SetCouponActiveUseCase,
    private readonly deleteCoupon: DeleteCouponUseCase,
    private readonly listBanners: ListBannersUseCase,
    private readonly createBanner: CreateBannerUseCase,
    private readonly updateBanner: UpdateBannerUseCase,
    private readonly deleteBanner: DeleteBannerUseCase,
    private readonly reorderBanners: ReorderBannersUseCase,
    private readonly listSettings: ListSettingsUseCase,
    private readonly upsertSettings: UpsertSettingsUseCase,
    private readonly deleteSetting: DeleteSettingUseCase,
  ) {}

  // ── Coupons ────────────────────────────────────────────────

  @Get('coupons/available')
  @ApiOperation({
    summary: 'Offers a customer could use right now',
    description:
      'Only live coupons — active, inside their window and not exhausted. ' +
      'Whether one applies to a particular basket is decided at checkout by ' +
      '`POST /cart/coupon`, which knows what is in it.',
  })
  @ApiPaginatedResponse(CouponDto)
  availableCoupons(@Query() query: ListCouponsQueryDto): Promise<PaginatedResult<CouponDto>> {
    return this.listCoupons.execute(query, { liveOnly: true });
  }

  @Get('coupons')
  @RequirePermissions('coupons.read')
  @ApiOperation({
    summary: 'All coupons',
    description: 'Including expired and deactivated ones — the campaign history.',
  })
  @ApiPaginatedResponse(CouponDto)
  coupons(@Query() query: ListCouponsQueryDto): Promise<PaginatedResult<CouponDto>> {
    return this.listCoupons.execute(query);
  }

  @Get('coupons/:id')
  @RequirePermissions('coupons.read')
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: 'Get a coupon' })
  @ApiResponse({ status: 200, type: CouponDto })
  coupon(@Param('id') id: string): Promise<CouponDto> {
    return this.getCoupon.execute(id);
  }

  @Post('coupons')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('coupons.create')
  @ApiOperation({
    summary: 'Create a coupon',
    description:
      'The shape is checked before it is saved: a percentage coupon needs a ' +
      'ceiling, and a fixed discount cannot exceed the minimum order it applies ' +
      'to. A coupon is the one thing an operator can create that spends money ' +
      'directly, and a malformed one is found by customers before it is found ' +
      'by finance.',
  })
  @ApiResponse({ status: 201, type: CouponDto })
  @ApiResponse({ status: 409, description: 'That code is already in use.' })
  @ApiResponse({ status: 422, description: 'The coupon would behave incoherently.' })
  newCoupon(
    @Body() dto: CreateCouponDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<CouponDto> {
    return this.createCoupon.execute(dto, actor);
  }

  @Patch('coupons/:id')
  @RequirePermissions('coupons.update')
  @ApiParam({ name: 'id' })
  @ApiOperation({
    summary: 'Edit a coupon',
    description:
      'Validated against the merged result, not the patch — a change that is ' +
      'harmless alone can still produce an incoherent coupon. The code is fixed ' +
      'once somebody has redeemed it.',
  })
  @ApiResponse({ status: 200, type: CouponDto })
  editCoupon(@Param('id') id: string, @Body() dto: UpdateCouponDto): Promise<CouponDto> {
    return this.updateCoupon.execute(id, dto);
  }

  @Post('coupons/:id/deactivate')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('coupons.update')
  @ApiParam({ name: 'id' })
  @ApiOperation({
    summary: 'Stop a campaign',
    description: 'The kill switch. Keeps the history that deleting would erase.',
  })
  @ApiResponse({ status: 200, type: CouponDto })
  deactivateCoupon(@Param('id') id: string): Promise<CouponDto> {
    return this.setCouponActive.execute(id, false);
  }

  @Post('coupons/:id/activate')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('coupons.update')
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: 'Restart a campaign' })
  @ApiResponse({ status: 200, type: CouponDto })
  activateCoupon(@Param('id') id: string): Promise<CouponDto> {
    return this.setCouponActive.execute(id, true);
  }

  @Delete('coupons/:id')
  @RequirePermissions('coupons.delete')
  @ApiParam({ name: 'id' })
  @ApiOperation({
    summary: 'Delete an unused coupon',
    description:
      'Only one nobody has redeemed. A used coupon is part of somebody’s ' +
      'receipt, so it is deactivated instead of deleted.',
  })
  @ApiResponse({ status: 200, description: 'Deleted.' })
  @ApiResponse({ status: 422, description: 'It has been redeemed. Deactivate it instead.' })
  removeCoupon(@Param('id') id: string): Promise<{ message: string }> {
    return this.deleteCoupon.execute(id);
  }

  // ── Banners ────────────────────────────────────────────────

  @Get('banners')
  @Public()
  @ApiOperation({
    summary: 'Banners to show right now',
    description:
      'Public. Active and inside their display window, ordered for the ' +
      'carousel. Filtering by city also returns the banners with no city, ' +
      'which run everywhere — excluding them would empty the carousel outside ' +
      'the cities that happen to have their own artwork.',
  })
  @ApiQuery({ name: 'placement', required: false })
  @ApiQuery({ name: 'cityId', required: false })
  @ApiPaginatedResponse(BannerDto)
  liveBanners(@Query() query: ListBannersQueryDto): Promise<PaginatedResult<BannerDto>> {
    return this.listBanners.execute(query, { liveOnly: true });
  }

  @Get('banner-management')
  @RequirePermissions('banners.read')
  @ApiOperation({ summary: 'All banners', description: 'Including scheduled and expired.' })
  @ApiPaginatedResponse(BannerDto)
  allBanners(@Query() query: ListBannersQueryDto): Promise<PaginatedResult<BannerDto>> {
    return this.listBanners.execute(query);
  }

  @Post('banner-management')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('banners.create')
  @ApiOperation({
    summary: 'Create a banner',
    description: 'Leave the window empty to show it immediately and indefinitely.',
  })
  @ApiResponse({ status: 201, type: BannerDto })
  newBanner(@Body() dto: CreateBannerDto): Promise<BannerDto> {
    return this.createBanner.execute(dto);
  }

  @Patch('banner-management/:id')
  @RequirePermissions('banners.update')
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: 'Edit a banner' })
  @ApiResponse({ status: 200, type: BannerDto })
  editBanner(@Param('id') id: string, @Body() dto: UpdateBannerDto): Promise<BannerDto> {
    return this.updateBanner.execute(id, dto);
  }

  @Put('banner-management/order')
  @RequirePermissions('banners.update')
  @ApiOperation({
    summary: 'Reorder the carousel',
    description:
      'Applied in one transaction: a half-applied reorder leaves two banners ' +
      'claiming the same slot and the ordering becomes arbitrary.',
  })
  @ApiResponse({ status: 200, type: [BannerDto] })
  reorder(@Body() dto: ReorderBannersDto): Promise<BannerDto[]> {
    return this.reorderBanners.execute(dto);
  }

  @Delete('banner-management/:id')
  @RequirePermissions('banners.delete')
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: 'Delete a banner' })
  @ApiResponse({ status: 200, description: 'Deleted.' })
  removeBanner(@Param('id') id: string): Promise<{ message: string }> {
    return this.deleteBanner.execute(id);
  }

  // ── Settings ───────────────────────────────────────────────

  @Get('settings/public')
  @Public()
  @ApiOperation({
    summary: 'Settings the apps are allowed to read',
    description:
      'Public entries only — service fees, minimum orders, support numbers. ' +
      'Values come back coerced to their declared type, so a client never has ' +
      'to parse "5" into a number by convention and one day parse "false" into ' +
      'true.',
  })
  @ApiResponse({ status: 200, type: [SettingDto] })
  publicSettings(@Query('group') group?: string): Promise<SettingDto[]> {
    return this.listSettings.flat({ group, publicOnly: true });
  }

  @Get('settings')
  @RequirePermissions('settings.read')
  @ApiOperation({
    summary: 'All settings, grouped',
    description: 'The configuration screen, in the shape it renders.',
  })
  @ApiResponse({ status: 200, type: [SettingGroupDto] })
  settings(@Query('group') group?: string): Promise<SettingGroupDto[]> {
    return this.listSettings.execute({ group });
  }

  @Put('settings')
  @RequirePermissions('settings.update')
  @ApiOperation({
    summary: 'Write settings',
    description:
      'All or nothing: related settings are meaningless apart, and a ' +
      'quiet-hours start applied without its end is a window nobody ' +
      'configured. Each value is checked against its declared type first, so a ' +
      'NUMBER setting cannot be saved as "five" and discovered by the pricing ' +
      'engine.',
  })
  @ApiResponse({ status: 200, type: [SettingDto] })
  @ApiResponse({ status: 422, description: 'A value does not match its declared type.' })
  writeSettings(
    @Body() dto: UpsertSettingsDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<SettingDto[]> {
    return this.upsertSettings.execute(dto, actor);
  }

  @Delete('settings/:key')
  @RequirePermissions('settings.update')
  @ApiParam({ name: 'key', example: 'platform.service_fee_percentage' })
  @ApiOperation({
    summary: 'Remove a setting',
    description: 'The application default takes over — every reader has one.',
  })
  @ApiResponse({ status: 200, description: 'Deleted.' })
  removeSetting(@Param('key') key: string): Promise<{ message: string }> {
    return this.deleteSetting.execute(key);
  }
}
