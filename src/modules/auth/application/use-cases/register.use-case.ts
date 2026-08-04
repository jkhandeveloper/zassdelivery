import { Injectable } from '@nestjs/common';
import { UserRole } from '@prisma/client';

import {
  BusinessRuleViolationException,
  ResourceConflictException,
} from '@/common/exceptions/domain.exception';

import { AuthUserRepository } from '../../domain/repositories/auth-user.repository';
import { RefreshTokenRepository } from '../../domain/repositories/refresh-token.repository';
import type { AuthResponseDto } from '../dto/auth-response.dto';
import type { RegisterDto } from '../dto/auth.dto';
import { PasswordService } from '../services/password.service';
import { TokenService } from '../services/token.service';
import { toAuthResponse } from './auth.mapper';

/** Roles a member of the public may create for themselves. */
const SELF_SERVICE_ROLES: UserRole[] = [UserRole.CUSTOMER, UserRole.RIDER];

export interface RegisterContext {
  userAgent?: string;
  ipAddress?: string;
}

@Injectable()
export class RegisterUseCase {
  constructor(
    private readonly users: AuthUserRepository,
    private readonly refreshTokens: RefreshTokenRepository,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
  ) {}

  async execute(dto: RegisterDto, context: RegisterContext = {}): Promise<AuthResponseDto> {
    const role = dto.role ?? UserRole.CUSTOMER;

    // Without this check anyone could POST role=SUPER_ADMIN and grant
    // themselves the platform.
    if (!SELF_SERVICE_ROLES.includes(role)) {
      throw new BusinessRuleViolationException(
        `Accounts with the ${role} role are created by an administrator, not through registration.`,
      );
    }

    if (await this.users.existsByPhone(dto.phone)) {
      throw new ResourceConflictException('An account with this phone number already exists.');
    }

    if (dto.email && (await this.users.existsByEmail(dto.email))) {
      throw new ResourceConflictException('An account with this email address already exists.');
    }

    const passwordHash = await this.passwords.hash(dto.password);

    const user = await this.users.create({
      phone: dto.phone,
      fullName: dto.fullName,
      passwordHash,
      email: dto.email,
      role,
    });

    // Registering signs the user straight in — requiring an immediate second
    // round-trip to log in would be friction with no security benefit.
    const issued = await this.tokens.issueTokens(user);

    await this.refreshTokens.create({
      userId: user.id,
      tokenHash: issued.refreshTokenHash,
      // A fresh login starts a new rotation family.
      familyId: issued.sessionId,
      expiresAt: issued.refreshExpiresAt,
      userAgent: context.userAgent,
      ipAddress: context.ipAddress,
    });

    return toAuthResponse(user, issued);
  }
}
