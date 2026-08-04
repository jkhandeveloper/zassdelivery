import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';

import { jwtConfig } from '@/config';

import { AuthController } from './auth.controller';
import { PasswordService } from './application/services/password.service';
import { TokenService } from './application/services/token.service';
import { ChangePasswordUseCase } from './application/use-cases/change-password.use-case';
import { LoginUseCase } from './application/use-cases/login.use-case';
import { LogoutUseCase } from './application/use-cases/logout.use-case';
import { RefreshTokenUseCase } from './application/use-cases/refresh-token.use-case';
import { RegisterUseCase } from './application/use-cases/register.use-case';
import { AuthUserRepository } from './domain/repositories/auth-user.repository';
import { RefreshTokenRepository } from './domain/repositories/refresh-token.repository';
import { PrismaAuthUserRepository } from './infrastructure/repositories/prisma-auth-user.repository';
import { PrismaRefreshTokenRepository } from './infrastructure/repositories/prisma-refresh-token.repository';

@Module({
  imports: [
    ConfigModule.forFeature(jwtConfig),
    // Secrets are passed per sign/verify call rather than registered globally,
    // because access and refresh tokens are signed with different keys.
    JwtModule.register({}),
  ],
  controllers: [AuthController],
  providers: [
    PasswordService,
    TokenService,
    RegisterUseCase,
    LoginUseCase,
    RefreshTokenUseCase,
    LogoutUseCase,
    ChangePasswordUseCase,

    // Abstract classes double as DI tokens, so use-cases depend on the port
    // and never on Prisma.
    { provide: AuthUserRepository, useClass: PrismaAuthUserRepository },
    { provide: RefreshTokenRepository, useClass: PrismaRefreshTokenRepository },
  ],
  // TokenService and JwtModule are exported for the global JwtAuthGuard.
  // RefreshTokenRepository is exported so other modules can end a user's
  // sessions when a role change, suspension or deletion demands it.
  exports: [TokenService, PasswordService, JwtModule, AuthUserRepository, RefreshTokenRepository],
})
export class AuthModule {}
