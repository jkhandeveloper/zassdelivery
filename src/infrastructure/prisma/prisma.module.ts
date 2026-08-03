import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { databaseConfig } from '@/config';

import { PrismaService } from './prisma.service';

/**
 * Global so feature modules can inject `PrismaService` in their repository
 * implementations without importing this module every time.
 */
@Global()
@Module({
  imports: [ConfigModule.forFeature(databaseConfig)],
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
