import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';

import { smsConfig } from '@/config';

import { SmsSender } from '../../domain/services/sms-sender';

const SEND_TIMEOUT_MS = 15_000;

/**
 * textbee.dev: SMS sent by an Android phone, from its own SIM.
 *
 * Chosen because it is free at the point of sending. A commercial gateway in
 * Pakistan charges per message and wants a business registration first; this
 * needs a spare phone with an SMS bundle and the textbee app signed in.
 */
@Injectable()
export class TextbeeSmsSender extends SmsSender {
  readonly name = 'textbee';

  constructor(
    @Inject(smsConfig.KEY)
    private readonly config: ConfigType<typeof smsConfig>,
  ) {
    super();
  }

  isConfigured(): boolean {
    return this.config.textbee.apiKey !== '' && this.config.textbee.deviceId !== '';
  }

  async send(to: string, message: string): Promise<void> {
    const { baseUrl, apiKey, deviceId } = this.config.textbee;

    const response = await fetch(
      `${baseUrl}/api/v1/gateway/devices/${encodeURIComponent(deviceId)}/send-sms`,
      {
        method: 'POST',
        headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipients: [to], message }),
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      },
    );

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`textbee responded ${response.status}: ${body.slice(0, 200)}`);
    }
  }
}
