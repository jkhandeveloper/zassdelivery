import { registerAs } from '@nestjs/config';

import { NodeEnv } from './env.validation';

export const SMS_CONFIG_KEY = 'sms';

export type SmsProviderName = 'textbee' | 'log' | 'none';

/**
 * Where phone verification codes are sent from.
 *
 * `textbee` is textbee.dev: an open-source gateway that sends through an
 * Android phone's own SIM. The platform pays nothing per message — only the
 * SIM's SMS bundle, which in Pakistan is a few hundred rupees a month for
 * thousands of texts. Its hosted service is free, and it can be self-hosted.
 *
 * `log` writes the code to the API's log instead. It is for development only
 * and is refused in production, where it would leave every new customer
 * waiting for a text that never comes.
 *
 * Unset means `log` in development and `none` in production: with no sender
 * configured, verification switches itself off rather than blocking sign-up.
 */
export const smsConfig = registerAs(SMS_CONFIG_KEY, () => {
  const nodeEnv = (process.env.NODE_ENV ?? NodeEnv.Development) as NodeEnv;
  const isProduction = nodeEnv === NodeEnv.Production;
  const requested = (process.env.SMS_PROVIDER ?? '').trim().toLowerCase();

  const provider: SmsProviderName =
    requested === 'textbee'
      ? 'textbee'
      : requested === 'none'
        ? 'none'
        : isProduction
          ? 'none'
          : 'log';

  return {
    provider,
    textbee: {
      baseUrl: (process.env.TEXTBEE_BASE_URL ?? 'https://api.textbee.dev').replace(/\/+$/, ''),
      apiKey: process.env.TEXTBEE_API_KEY ?? '',
      deviceId: process.env.TEXTBEE_DEVICE_ID ?? '',
    },
  };
});
