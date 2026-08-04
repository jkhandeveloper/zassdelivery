import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';

import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { Public } from '@/common/decorators/public.decorator';
import { ApiErrorResponseDto } from '@/common/dto/api-response.dto';
import { ResourceNotFoundException } from '@/common/exceptions/domain.exception';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';

import {
  AuthResponseDto,
  AuthUserDto,
  MessageResponseDto,
} from './application/dto/auth-response.dto';
import {
  ChangePasswordDto,
  LoginDto,
  LogoutDto,
  RefreshTokenDto,
  RegisterDto,
} from './application/dto/auth.dto';
import { toAuthUserDto } from './application/use-cases/auth.mapper';
import { ChangePasswordUseCase } from './application/use-cases/change-password.use-case';
import { LoginUseCase } from './application/use-cases/login.use-case';
import { LogoutUseCase } from './application/use-cases/logout.use-case';
import { RefreshTokenUseCase } from './application/use-cases/refresh-token.use-case';
import { RegisterUseCase } from './application/use-cases/register.use-case';
import { AuthUserRepository } from './domain/repositories/auth-user.repository';

@ApiTags('Authentication')
@ApiResponse({ status: 400, description: 'Validation failed.', type: ApiErrorResponseDto })
@Controller('auth')
export class AuthController {
  constructor(
    private readonly registerUseCase: RegisterUseCase,
    private readonly loginUseCase: LoginUseCase,
    private readonly refreshTokenUseCase: RefreshTokenUseCase,
    private readonly logoutUseCase: LogoutUseCase,
    private readonly changePasswordUseCase: ChangePasswordUseCase,
    private readonly users: AuthUserRepository,
  ) {}

  @Public()
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  // Registration is expensive (an Argon2 hash) and attractive to abuse, so it
  // gets a far tighter budget than the global default.
  @Throttle({ default: { limit: 5, ttl: 3600000 } })
  @ApiOperation({
    summary: 'Register a new account',
    description:
      'Creates a CUSTOMER or RIDER account and signs the user in immediately. ' +
      'Staff, vendor and admin accounts are created by an administrator.',
  })
  @ApiResponse({ status: 201, description: 'Account created.', type: AuthResponseDto })
  @ApiResponse({ status: 409, description: 'Phone or email already registered.' })
  @ApiResponse({ status: 422, description: 'The requested role is not self-service.' })
  register(@Body() dto: RegisterDto, @Req() request: Request): Promise<AuthResponseDto> {
    return this.registerUseCase.execute(dto, this.contextOf(request));
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 300000 } })
  @ApiOperation({
    summary: 'Sign in with phone and password',
    description:
      'Five consecutive failures lock the account for 15 minutes. The response ' +
      'does not distinguish an unknown number from a wrong password.',
  })
  @ApiResponse({ status: 200, description: 'Signed in.', type: AuthResponseDto })
  @ApiResponse({ status: 401, description: 'Invalid credentials.' })
  @ApiResponse({ status: 403, description: 'Account suspended or temporarily locked.' })
  login(@Body() dto: LoginDto, @Req() request: Request): Promise<AuthResponseDto> {
    return this.loginUseCase.execute(dto, this.contextOf(request));
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 30, ttl: 300000 } })
  @ApiOperation({
    summary: 'Exchange a refresh token for a new token pair',
    description:
      'Refresh tokens rotate on every use. Presenting a token that has already ' +
      'been rotated is treated as theft and revokes the entire session family.',
  })
  @ApiResponse({ status: 200, description: 'New tokens issued.', type: AuthResponseDto })
  @ApiResponse({ status: 401, description: 'Refresh token invalid, expired or replayed.' })
  refresh(@Body() dto: RefreshTokenDto, @Req() request: Request): Promise<AuthResponseDto> {
    return this.refreshTokenUseCase.execute(dto.refreshToken, this.contextOf(request));
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('access-token')
  @ApiBody({ type: LogoutDto, required: false })
  @ApiOperation({
    summary: 'Sign out',
    description:
      'Revokes the refresh token and denies the current access token immediately, ' +
      'rather than waiting for it to expire. Set allDevices to end every session.',
  })
  @ApiResponse({ status: 200, description: 'Signed out.', type: MessageResponseDto })
  @ApiResponse({ status: 401, description: 'Not authenticated.' })
  logout(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: LogoutDto,
  ): Promise<MessageResponseDto> {
    return this.logoutUseCase.execute(user.id, user.sessionId, dto);
  }

  @Get('me')
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Get the current user',
    description: 'Reads the account fresh from the database rather than from token claims.',
  })
  @ApiResponse({ status: 200, description: 'The authenticated user.', type: AuthUserDto })
  @ApiResponse({ status: 401, description: 'Not authenticated.' })
  async me(@CurrentUser('id') userId: string): Promise<AuthUserDto> {
    const user = await this.users.findById(userId);

    if (!user) {
      // The token verified, so the account was deleted after it was issued.
      throw new ResourceNotFoundException('User', userId);
    }

    return toAuthUserDto(user);
  }

  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Change the current password',
    description:
      'Requires the existing password. On success every other session is signed ' +
      'out; the session making the request stays active.',
  })
  @ApiResponse({ status: 200, description: 'Password changed.', type: MessageResponseDto })
  @ApiResponse({ status: 401, description: 'Current password incorrect.' })
  changePassword(
    @CurrentUser('id') userId: string,
    @Body() dto: ChangePasswordDto,
  ): Promise<MessageResponseDto> {
    return this.changePasswordUseCase.execute(userId, dto);
  }

  /** Captures the device fingerprint stored against each session. */
  private contextOf(request: Request): { userAgent?: string; ipAddress?: string } {
    return {
      userAgent: request.headers['user-agent'],
      ipAddress: request.ip,
    };
  }
}
