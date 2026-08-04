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

import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { ApiPaginatedResponse } from '@/common/decorators/api-paginated-response.decorator';
import { RequirePermissions } from '@/common/decorators/permissions.decorator';
import { ApiErrorResponseDto } from '@/common/dto/api-response.dto';
import type { PaginatedResult } from '@/common/interfaces/paginated-result.interface';

import { ListUsersQueryDto } from './application/dto/user-query.dto';
import { UserDto } from './application/dto/user-response.dto';
import { AdminUpdateUserDto, ChangeUserStatusDto, CreateUserDto } from './application/dto/user.dto';
import { MessageResponseDto } from '../auth/application/dto/auth-response.dto';
import {
  ChangeUserStatusUseCase,
  CreateUserUseCase,
  DeleteUserUseCase,
  GetUserUseCase,
  ListUsersUseCase,
  RestoreUserUseCase,
  UpdateUserUseCase,
} from './application/use-cases/users.use-cases';

/**
 * Administrative user management.
 *
 * Every route is permission-gated rather than role-gated, so a bespoke support
 * role can be granted read access without also inheriting the ability to delete
 * accounts.
 */
@ApiTags('Users (Admin)')
@ApiBearerAuth('access-token')
@ApiResponse({ status: 401, description: 'Not authenticated.', type: ApiErrorResponseDto })
@ApiResponse({ status: 403, description: 'Missing permission.', type: ApiErrorResponseDto })
@Controller('users')
export class UsersController {
  constructor(
    private readonly listUsers: ListUsersUseCase,
    private readonly getUser: GetUserUseCase,
    private readonly createUser: CreateUserUseCase,
    private readonly updateUser: UpdateUserUseCase,
    private readonly changeStatus: ChangeUserStatusUseCase,
    private readonly deleteUser: DeleteUserUseCase,
    private readonly restoreUser: RestoreUserUseCase,
  ) {}

  @Get()
  @RequirePermissions('users.read')
  @ApiOperation({
    summary: 'List users',
    description:
      'Paginated, filterable and sortable. Free-text search matches name, phone ' +
      'and email and is backed by trigram indexes. Soft-deleted accounts are ' +
      'excluded unless includeDeleted is set.',
  })
  @ApiPaginatedResponse(UserDto)
  list(@Query() query: ListUsersQueryDto): Promise<PaginatedResult<UserDto>> {
    return this.listUsers.execute(query);
  }

  @Get(':id')
  @RequirePermissions('users.read')
  @ApiParam({ name: 'id', description: 'User id (cuid).' })
  @ApiOperation({ summary: 'Get a user by id' })
  @ApiResponse({ status: 200, type: UserDto })
  @ApiResponse({ status: 404, description: 'User not found.' })
  get(@Param('id') id: string): Promise<UserDto> {
    return this.getUser.execute(id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('users.create')
  @ApiOperation({
    summary: 'Create a user',
    description:
      'Unlike registration, any role may be assigned here — this is how vendor, ' +
      'staff and admin accounts are provisioned.',
  })
  @ApiResponse({ status: 201, type: UserDto })
  @ApiResponse({ status: 409, description: 'Phone or email already in use.' })
  create(@Body() dto: CreateUserDto): Promise<UserDto> {
    return this.createUser.execute(dto);
  }

  @Patch(':id')
  @RequirePermissions('users.update')
  @ApiParam({ name: 'id' })
  @ApiOperation({
    summary: 'Update a user',
    description:
      'Changing a role re-assigns permissions and signs the account out, so the ' +
      'new role takes effect immediately rather than at the next token expiry.',
  })
  @ApiResponse({ status: 200, type: UserDto })
  @ApiResponse({ status: 404, description: 'User not found.' })
  @ApiResponse({ status: 422, description: 'Cannot change your own role.' })
  update(
    @Param('id') id: string,
    @Body() dto: AdminUpdateUserDto,
    @CurrentUser('id') actorId: string,
  ): Promise<UserDto> {
    return this.updateUser.execute(id, dto, actorId);
  }

  @Patch(':id/status')
  @RequirePermissions('users.suspend')
  @ApiParam({ name: 'id' })
  @ApiOperation({
    summary: 'Suspend, ban or reactivate a user',
    description: 'Suspending or banning revokes every session immediately.',
  })
  @ApiResponse({ status: 200, type: UserDto })
  @ApiResponse({ status: 422, description: 'Cannot change your own status.' })
  setStatus(
    @Param('id') id: string,
    @Body() dto: ChangeUserStatusDto,
    @CurrentUser('id') actorId: string,
  ): Promise<UserDto> {
    return this.changeStatus.execute(id, dto, actorId);
  }

  @Delete(':id')
  @RequirePermissions('users.delete')
  @ApiParam({ name: 'id' })
  @ApiOperation({
    summary: 'Delete a user',
    description:
      'Soft delete — orders, payments and reviews reference the account and must ' +
      'keep resolving. The last remaining super admin cannot be deleted.',
  })
  @ApiResponse({ status: 200, type: MessageResponseDto })
  @ApiResponse({ status: 422, description: 'Cannot delete yourself or the last super admin.' })
  remove(@Param('id') id: string, @CurrentUser('id') actorId: string): Promise<MessageResponseDto> {
    return this.deleteUser.execute(id, actorId);
  }

  @Post(':id/restore')
  @RequirePermissions('users.update')
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: 'Restore a soft-deleted user' })
  @ApiResponse({ status: 200, type: UserDto })
  @ApiResponse({ status: 409, description: 'The phone number now belongs to another account.' })
  restore(@Param('id') id: string): Promise<UserDto> {
    return this.restoreUser.execute(id);
  }
}
