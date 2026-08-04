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
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';

import { ApiPaginatedResponse } from '@/common/decorators/api-paginated-response.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { ApiErrorResponseDto } from '@/common/dto/api-response.dto';
import type { PaginatedResult } from '@/common/interfaces/paginated-result.interface';

import { MessageResponseDto } from '../auth/application/dto/auth-response.dto';
import { CreateAddressDto, UpdateAddressDto } from './application/dto/address.dto';
import { CreateFavoriteDto, FavoriteDto } from './application/dto/favorite.dto';
import {
  NotificationPreferenceDto,
  UpdateNotificationPreferencesDto,
} from './application/dto/notification-preference.dto';
import { ListAddressesQueryDto, ListFavoritesQueryDto } from './application/dto/user-query.dto';
import { AddressDto, UserDto } from './application/dto/user-response.dto';
import { UpdateProfileDto } from './application/dto/user.dto';
import {
  CreateAddressUseCase,
  DeleteAddressUseCase,
  GetAddressUseCase,
  ListAddressesUseCase,
  SetDefaultAddressUseCase,
  UpdateAddressUseCase,
} from './application/use-cases/addresses.use-cases';
import {
  AddFavoriteUseCase,
  ListFavoritesUseCase,
  RemoveFavoriteUseCase,
} from './application/use-cases/favorites.use-cases';
import {
  GetNotificationPreferencesUseCase,
  GetProfileUseCase,
  ResetNotificationPreferencesUseCase,
  UpdateNotificationPreferencesUseCase,
  UpdateProfileUseCase,
} from './application/use-cases/profile.use-cases';

/**
 * Everything a signed-in user can do to their own account.
 *
 * Ownership is taken from the access token, never from the URL — there is no
 * `:userId` parameter anywhere here, so one customer cannot reach another's
 * addresses or favorites by changing an id.
 */
@ApiTags('Me')
@ApiBearerAuth('access-token')
@ApiResponse({ status: 401, description: 'Not authenticated.', type: ApiErrorResponseDto })
@Controller('me')
export class MeController {
  constructor(
    private readonly getProfile: GetProfileUseCase,
    private readonly updateProfile: UpdateProfileUseCase,
    private readonly getPreferences: GetNotificationPreferencesUseCase,
    private readonly updatePreferences: UpdateNotificationPreferencesUseCase,
    private readonly resetPreferences: ResetNotificationPreferencesUseCase,
    private readonly listAddresses: ListAddressesUseCase,
    private readonly getAddress: GetAddressUseCase,
    private readonly createAddress: CreateAddressUseCase,
    private readonly updateAddress: UpdateAddressUseCase,
    private readonly setDefaultAddress: SetDefaultAddressUseCase,
    private readonly deleteAddress: DeleteAddressUseCase,
    private readonly listFavorites: ListFavoritesUseCase,
    private readonly addFavorite: AddFavoriteUseCase,
    private readonly removeFavorite: RemoveFavoriteUseCase,
  ) {}

  // ── Profile ────────────────────────────────────────────────

  @Get()
  @ApiOperation({ summary: 'Get my profile' })
  @ApiResponse({ status: 200, type: UserDto })
  profile(@CurrentUser('id') userId: string): Promise<UserDto> {
    return this.getProfile.execute(userId);
  }

  @Patch()
  @ApiOperation({
    summary: 'Update my profile',
    description:
      'Phone, role and status are deliberately not editable here: the phone is ' +
      'the login identity and needs re-verification, and the other two are ' +
      'privilege decisions that belong to an administrator.',
  })
  @ApiResponse({ status: 200, type: UserDto })
  @ApiResponse({ status: 409, description: 'Email already in use.' })
  update(@CurrentUser('id') userId: string, @Body() dto: UpdateProfileDto): Promise<UserDto> {
    return this.updateProfile.execute(userId, dto);
  }

  // ── Notification preferences ───────────────────────────────

  @Get('notification-preferences')
  @ApiOperation({
    summary: 'Get my notification preferences',
    description:
      'Returns every category, with stored choices merged over the defaults, so ' +
      'the whole settings screen renders from one response.',
  })
  @ApiResponse({ status: 200, type: [NotificationPreferenceDto] })
  preferences(@CurrentUser('id') userId: string): Promise<NotificationPreferenceDto[]> {
    return this.getPreferences.execute(userId);
  }

  @Patch('notification-preferences')
  @ApiOperation({
    summary: 'Update my notification preferences',
    description: 'Categories omitted from the request are left untouched.',
  })
  @ApiResponse({ status: 200, type: [NotificationPreferenceDto] })
  setPreferences(
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateNotificationPreferencesDto,
  ): Promise<NotificationPreferenceDto[]> {
    return this.updatePreferences.execute(userId, dto);
  }

  @Delete('notification-preferences')
  @ApiOperation({ summary: 'Reset my notification preferences to the defaults' })
  @ApiResponse({ status: 200, type: [NotificationPreferenceDto] })
  clearPreferences(@CurrentUser('id') userId: string): Promise<NotificationPreferenceDto[]> {
    return this.resetPreferences.execute(userId);
  }

  // ── Addresses ──────────────────────────────────────────────

  @Get('addresses')
  @ApiOperation({
    summary: 'List my addresses',
    description: 'The default address is always returned first.',
  })
  @ApiPaginatedResponse(AddressDto)
  addresses(
    @CurrentUser('id') userId: string,
    @Query() query: ListAddressesQueryDto,
  ): Promise<PaginatedResult<AddressDto>> {
    return this.listAddresses.execute(userId, query);
  }

  @Get('addresses/:id')
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: 'Get one of my addresses' })
  @ApiResponse({ status: 200, type: AddressDto })
  @ApiResponse({ status: 404, description: 'Address not found.' })
  address(@CurrentUser('id') userId: string, @Param('id') id: string): Promise<AddressDto> {
    return this.getAddress.execute(userId, id);
  }

  @Post('addresses')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Save a new address',
    description:
      'The delivery zone is resolved from the coordinates, not taken from the ' +
      'request — delivery fees are priced off it. Locations outside every zone ' +
      'are rejected. The first address saved becomes the default.',
  })
  @ApiResponse({ status: 201, type: AddressDto })
  @ApiResponse({ status: 422, description: 'Outside the delivery area, or address limit reached.' })
  addAddress(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateAddressDto,
  ): Promise<AddressDto> {
    return this.createAddress.execute(userId, dto);
  }

  @Patch('addresses/:id')
  @ApiParam({ name: 'id' })
  @ApiOperation({
    summary: 'Update one of my addresses',
    description: 'Moving the coordinates re-resolves the delivery zone.',
  })
  @ApiResponse({ status: 200, type: AddressDto })
  editAddress(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateAddressDto,
  ): Promise<AddressDto> {
    return this.updateAddress.execute(userId, id, dto);
  }

  @Patch('addresses/:id/default')
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: 'Make an address my default' })
  @ApiResponse({ status: 200, type: AddressDto })
  makeDefault(@CurrentUser('id') userId: string, @Param('id') id: string): Promise<AddressDto> {
    return this.setDefaultAddress.execute(userId, id);
  }

  @Delete('addresses/:id')
  @ApiParam({ name: 'id' })
  @ApiOperation({
    summary: 'Delete one of my addresses',
    description: 'Soft delete, so past orders that reference it still resolve.',
  })
  @ApiResponse({ status: 200, type: MessageResponseDto })
  removeAddress(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
  ): Promise<MessageResponseDto> {
    return this.deleteAddress.execute(userId, id);
  }

  // ── Favorites ──────────────────────────────────────────────

  @Get('favorites')
  @ApiOperation({ summary: 'List my favorites' })
  @ApiPaginatedResponse(FavoriteDto)
  favorites(
    @CurrentUser('id') userId: string,
    @Query() query: ListFavoritesQueryDto,
  ): Promise<PaginatedResult<FavoriteDto>> {
    return this.listFavorites.execute(userId, query);
  }

  @Post('favorites')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Add a favorite',
    description: 'Provide exactly one of restaurantId or menuItemId.',
  })
  @ApiResponse({ status: 201, type: FavoriteDto })
  @ApiResponse({ status: 409, description: 'Already in favorites.' })
  favorite(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateFavoriteDto,
  ): Promise<FavoriteDto> {
    return this.addFavorite.execute(userId, dto);
  }

  @Delete('favorites/restaurants/:restaurantId')
  @ApiParam({ name: 'restaurantId' })
  @ApiOperation({ summary: 'Remove a restaurant from my favorites' })
  @ApiResponse({ status: 200, type: MessageResponseDto })
  unfavoriteRestaurant(
    @CurrentUser('id') userId: string,
    @Param('restaurantId') restaurantId: string,
  ): Promise<MessageResponseDto> {
    return this.removeFavorite.executeRestaurant(userId, restaurantId);
  }

  @Delete('favorites/menu-items/:menuItemId')
  @ApiParam({ name: 'menuItemId' })
  @ApiOperation({ summary: 'Remove a menu item from my favorites' })
  @ApiResponse({ status: 200, type: MessageResponseDto })
  unfavoriteMenuItem(
    @CurrentUser('id') userId: string,
    @Param('menuItemId') menuItemId: string,
  ): Promise<MessageResponseDto> {
    return this.removeFavorite.executeMenuItem(userId, menuItemId);
  }
}
