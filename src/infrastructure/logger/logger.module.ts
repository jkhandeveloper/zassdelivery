import { Global, Module } from '@nestjs/common';
import { ConfigModule, type ConfigType } from '@nestjs/config';
import { WinstonModule } from 'nest-winston';

import { loggerConfig } from '@/config';

import { createWinstonOptions } from './winston.factory';

/**
 * Registers Winston as the application-wide logger. Global so that any module
 * can inject `WINSTON_MODULE_NEST_PROVIDER` without re-importing.
 */
@Global()
@Module({
  imports: [
    WinstonModule.forRootAsync({
      imports: [ConfigModule.forFeature(loggerConfig)],
      inject: [loggerConfig.KEY],
      useFactory: (config: ConfigType<typeof loggerConfig>) => createWinstonOptions(config),
    }),
  ],
  exports: [WinstonModule],
})
export class LoggerModule {}
