import { Inject, Injectable, type LoggerService } from '@nestjs/common';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';

import { SmsSender } from '../../domain/services/sms-sender';

/**
 * Development only: the "text" is written to the API's log.
 *
 * Lets sign-up be exercised on a laptop and an emulator without a gateway.
 * `sms.config.ts` never selects it in production.
 */
@Injectable()
export class LogSmsSender extends SmsSender {
  readonly name = 'log';

  constructor(
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: LoggerService,
  ) {
    super();
  }

  isConfigured(): boolean {
    return true;
  }

  send(to: string, message: string): Promise<void> {
    this.logger.warn?.(`SMS to ${to}: ${message}`, LogSmsSender.name);

    return Promise.resolve();
  }
}

/** Production with no sender configured: verification is switched off. */
@Injectable()
export class DisabledSmsSender extends SmsSender {
  readonly name = 'none';

  isConfigured(): boolean {
    return false;
  }

  send(): Promise<void> {
    return Promise.reject(new Error('No SMS provider is configured.'));
  }
}
