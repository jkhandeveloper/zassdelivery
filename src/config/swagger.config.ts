import { registerAs } from '@nestjs/config';

export const SWAGGER_CONFIG_KEY = 'swagger';

export const swaggerConfig = registerAs(SWAGGER_CONFIG_KEY, () => ({
  enabled: process.env.SWAGGER_ENABLED !== 'false',
  path: process.env.SWAGGER_PATH ?? 'docs',
  title: 'ZassDelivery API',
  description:
    'Food delivery platform API serving Pabbi, Nowshera and Peshawar. ' +
    'All endpoints are versioned via the URI (e.g. /api/v1).',
  version: '1.0.0',
  contactName: 'ZassDelivery Engineering',
  contactEmail: 'engineering@zassdelivery.pk',
}));
