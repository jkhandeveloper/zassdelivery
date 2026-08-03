import { registerAs } from '@nestjs/config';

export const THROTTLE_CONFIG_KEY = 'throttle';

export const throttleConfig = registerAs(THROTTLE_CONFIG_KEY, () => ({
  ttl: Number(process.env.THROTTLE_TTL ?? 60000),
  limit: Number(process.env.THROTTLE_LIMIT ?? 120),
}));
