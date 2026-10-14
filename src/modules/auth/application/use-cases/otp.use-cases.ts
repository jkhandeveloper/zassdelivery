import { Injectable } from '@nestjs/common';
import { UserStatus } from '@prisma/client';

import {
  BusinessRuleViolationException,
  ForbiddenOperationException,
  ResourceConflictException,
} from '@/common/exceptions/domain.exception';

import { AuthUserRepository } from '../../domain/repositories/auth-user.repository';
import { RefreshTokenRepository } from '../../domain/repositories/refresh-token.repository';
import type { AuthResponseDto } from '../dto/auth-response.dto';
import type { OtpLoginDto, SendOtpDto } from '../dto/auth.dto';
import { PhoneOtpService, type OtpSettings } from '../services/phone-otp.service';
import { TokenService } from '../services/token.service';
import { toAuthResponse } from './auth.mapper';
import type { LoginContext } from './login.use-case';

const NO_ACCOUNT = 'No account uses this number. Sign up instead.';
const SUSPENDED = 'This account has been suspended. Please contact support.';

@Injectable()
export class SendOtpUseCase {
  constructor(
    private readonly users: AuthUserRepository,
    private readonly otp: PhoneOtpService,
  ) {}

  /**
   * Texts a code, after checking it could be used.
   *
   * Every text costs a little of the SIM's bundle, so one that could only fail
   * at the next step — a sign-up code for a number already registered, a
   * sign-in code for one that is not — is refused before it is sent.
   */
  async execute(dto: SendOtpDto): Promise<OtpSettings> {
    const user = await this.users.findByPhone(dto.phone);
    const exists = user !== null && user.deletedAt === null;

    if (dto.purpose === 'register' && exists) {
      throw new ResourceConflictException('An account with this phone number already exists.');
    }

    if (dto.purpose === 'login') {
      if (!exists) {
        throw new BusinessRuleViolationException(NO_ACCOUNT);
      }

      if (user.status === UserStatus.SUSPENDED || user.status === UserStatus.BANNED) {
        throw new ForbiddenOperationException(SUSPENDED);
      }
    }

    return this.otp.send(dto.phone, dto.purpose);
  }
}

@Injectable()
export class OtpLoginUseCase {
  constructor(
    private readonly users: AuthUserRepository,
    private readonly refreshTokens: RefreshTokenRepository,
    private readonly tokens: TokenService,
    private readonly otp: PhoneOtpService,
  ) {}

  /**
   * Signs in with a texted code instead of a password.
   *
   * For the customer who has forgotten theirs, or never really had one: the
   * phone in their hand is the account. It also verifies a number registered
   * before verification existed.
   */
  async execute(dto: OtpLoginDto, context: LoginContext = {}): Promise<AuthResponseDto> {
    await this.otp.verify(dto.phone, 'login', dto.code);

    const user = await this.users.findByPhone(dto.phone);

    if (!user || user.deletedAt !== null) {
      throw new BusinessRuleViolationException(NO_ACCOUNT);
    }

    if (user.status === UserStatus.SUSPENDED || user.status === UserStatus.BANNED) {
      throw new ForbiddenOperationException(SUSPENDED);
    }

    if (user.phoneVerifiedAt === null) {
      await this.users.markPhoneVerified(user.id);
      user.phoneVerifiedAt = new Date();
    }

    const issued = await this.tokens.issueTokens(user);

    await this.refreshTokens.create({
      userId: user.id,
      tokenHash: issued.refreshTokenHash,
      familyId: issued.sessionId,
      expiresAt: issued.refreshExpiresAt,
      userAgent: context.userAgent,
      ipAddress: context.ipAddress,
    });

    await this.users.recordLogin(user.id);

    return toAuthResponse(user, issued);
  }
}
