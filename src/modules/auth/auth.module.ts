import { Module } from '@nestjs/common';
import { ConfigModule, type ConfigType } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';

import { jwtConfig, smsConfig } from '@/config';

import { AuthController } from './auth.controller';
import { PasswordService } from './application/services/password.service';
import { PhoneOtpService } from './application/services/phone-otp.service';
import { TokenService } from './application/services/token.service';
import { ChangePasswordUseCase } from './application/use-cases/change-password.use-case';
import { LoginUseCase } from './application/use-cases/login.use-case';
import { LogoutUseCase } from './application/use-cases/logout.use-case';
import { OtpLoginUseCase, SendOtpUseCase } from './application/use-cases/otp.use-cases';
import { RefreshTokenUseCase } from './application/use-cases/refresh-token.use-case';
import { RegisterUseCase } from './application/use-cases/register.use-case';
import { AuthUserRepository } from './domain/repositories/auth-user.repository';
import { RefreshTokenRepository } from './domain/repositories/refresh-token.repository';
import { SmsSender } from './domain/services/sms-sender';
import { PrismaAuthUserRepository } from './infrastructure/repositories/prisma-auth-user.repository';
import { PrismaRefreshTokenRepository } from './infrastructure/repositories/prisma-refresh-token.repository';
import { DisabledSmsSender, LogSmsSender } from './infrastructure/sms/log.sms-sender';
import { TextbeeSmsSender } from './infrastructure/sms/textbee.sms-sender';

@Module({
  imports: [
    ConfigModule.forFeature(jwtConfig),
    ConfigModule.forFeature(smsConfig),
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
    PhoneOtpService,
    SendOtpUseCase,
    OtpLoginUseCase,
    TextbeeSmsSender,
    LogSmsSender,
    DisabledSmsSender,

    // The provider is chosen once, from configuration; see sms.config.ts.
    {
      provide: SmsSender,
      inject: [smsConfig.KEY, TextbeeSmsSender, LogSmsSender, DisabledSmsSender],
      useFactory: (
        config: ConfigType<typeof smsConfig>,
        textbee: TextbeeSmsSender,
        log: LogSmsSender,
        disabled: DisabledSmsSender,
      ): SmsSender =>
        config.provider === 'textbee' ? textbee : config.provider === 'log' ? log : disabled,
    },

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
