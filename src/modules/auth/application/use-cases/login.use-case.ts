import { Injectable, UnauthorizedException } from '@nestjs/common';
import { UserStatus } from '@prisma/client';

import { ForbiddenOperationException } from '@/common/exceptions/domain.exception';
import { RedisService } from '@/infrastructure/redis/redis.service';

import { AuthUserRepository } from '../../domain/repositories/auth-user.repository';
import { RefreshTokenRepository } from '../../domain/repositories/refresh-token.repository';
import type { AuthResponseDto } from '../dto/auth-response.dto';
import type { LoginDto } from '../dto/auth.dto';
import { PasswordService } from '../services/password.service';
import { TokenService } from '../services/token.service';
import { toAuthResponse } from './auth.mapper';

/** Failed attempts allowed before an account is locked out temporarily. */
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_SECONDS = 900;

export interface LoginContext {
  userAgent?: string;
  ipAddress?: string;
}

@Injectable()
export class LoginUseCase {
  constructor(
    private readonly users: AuthUserRepository,
    private readonly refreshTokens: RefreshTokenRepository,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly redis: RedisService,
  ) {}

  async execute(dto: LoginDto, context: LoginContext = {}): Promise<AuthResponseDto> {
    const attemptsKey = `auth:login-attempts:${dto.phone}`;
    const attempts = Number((await this.redis.get(attemptsKey)) ?? 0);

    // Throttling by phone rather than IP: an attacker rotating through a
    // proxy pool would otherwise get unlimited guesses at one account.
    if (attempts >= MAX_FAILED_ATTEMPTS) {
      const retryIn = await this.redis.ttl(attemptsKey);
      throw new ForbiddenOperationException(
        `Too many failed sign-in attempts. Try again in ${Math.max(retryIn, 0)} seconds.`,
      );
    }

    const user = await this.users.findByPhone(dto.phone);

    // One message for "no such account" and "wrong password" alike, so the
    // endpoint cannot be used to discover which numbers are registered.
    const invalid = new UnauthorizedException('Invalid phone number or password.');

    if (!user || user.deletedAt !== null || !user.passwordHash) {
      await this.recordFailure(attemptsKey);
      throw invalid;
    }

    const passwordMatches = await this.passwords.verify(user.passwordHash, dto.password);

    if (!passwordMatches) {
      await this.recordFailure(attemptsKey);
      throw invalid;
    }

    if (user.status === UserStatus.SUSPENDED || user.status === UserStatus.BANNED) {
      throw new ForbiddenOperationException(
        'This account has been suspended. Please contact support.',
      );
    }

    // Credentials were right: clear the counter so a later typo does not
    // inherit a nearly-exhausted budget.
    await this.redis.delete(attemptsKey);

    // Transparently upgrade hashes made under older, weaker parameters.
    if (this.passwords.needsRehash(user.passwordHash)) {
      await this.users.updatePassword(user.id, await this.passwords.hash(dto.password));
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

  private async recordFailure(key: string): Promise<void> {
    await this.redis.increment(key, LOCKOUT_SECONDS);
  }
}
