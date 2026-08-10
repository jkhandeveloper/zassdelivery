import 'reflect-metadata';

import { ValidationPipe, VersioningType, type LoggerService } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import compression from 'compression';
import helmet from 'helmet';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';

import { AppModule } from './app.module';
import { ApiErrorResponseDto, ApiSuccessResponseDto } from './common/dto/api-response.dto';
import { RedisService } from './infrastructure/redis/redis.service';
import { RedisIoAdapter } from './modules/realtime/infrastructure/redis-io.adapter';
import type { appConfig, swaggerConfig } from './config';
import type { ConfigType } from '@nestjs/config';

type AppConfig = ConfigType<typeof appConfig>;
type SwaggerConfig = ConfigType<typeof swaggerConfig>;

function configureSwagger(
  app: NestExpressApplication,
  swagger: SwaggerConfig,
  globalPrefix: string,
): void {
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle(swagger.title)
      .setDescription(swagger.description)
      .setVersion(swagger.version)
      .setContact(swagger.contactName, '', swagger.contactEmail)
      .addBearerAuth(
        {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Access token issued by POST /auth/verify-otp.',
        },
        'access-token',
      )
      .addTag('Riders', 'Rider self-service: onboarding, availability, deliveries, earnings')
      .addTag('Rider Management', 'Approval queue, dispatch board and withdrawal queue')
      .addTag('Payments', 'Checkout, verification, invoices and the customer’s transaction log')
      .addTag(
        'Payment Webhooks',
        'Public gateway callbacks — authenticated by signature, not by token',
      )
      .addTag('Payment Management', 'Refunds, reconciliation, the ledger and the callback log')
      .addTag('Notifications', 'A user’s own notifications, devices and delivery settings')
      .addTag('Notification Management', 'Campaigns, audiences and operator-sent messages')
      .addTag('Admin Dashboard', 'Platform statistics, reports and leaderboards')
      .addTag('Admin Content', 'Coupons, banners and platform settings')
      .addTag('Support', 'Support tickets, from both the customer and staff sides')
      .addTag('Audit Log', 'What staff changed, and when')
      .addTag('Realtime', 'The websocket protocol: rooms, events and reconnect behaviour')
      .addTag('Health', 'Liveness and readiness probes')
      .addServer(`http://localhost:${process.env.PORT ?? 3000}`, 'Local development')
      .build(),
    {
      // Registered explicitly because they are referenced by $ref from
      // decorators rather than appearing in any handler signature.
      extraModels: [ApiSuccessResponseDto, ApiErrorResponseDto],
    },
  );

  SwaggerModule.setup(`${globalPrefix}/${swagger.path}`, app, document, {
    swaggerOptions: {
      persistAuthorization: true,
      tagsSorter: 'alpha',
      operationsSorter: 'alpha',
    },
    customSiteTitle: 'ZassDelivery API Reference',
  });
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // Buffer startup logs until Winston is resolved, so nothing is emitted
    // through the default logger in the wrong format.
    bufferLogs: true,
  });

  const logger = app.get<LoggerService>(WINSTON_MODULE_NEST_PROVIDER);
  app.useLogger(logger);

  const configService = app.get(ConfigService);
  const application = configService.getOrThrow<AppConfig>('app');
  const swagger = configService.getOrThrow<SwaggerConfig>('swagger');

  // Trust the reverse proxy so `req.ip` and rate limiting see the real client.
  app.set('trust proxy', 1);

  app.use(
    helmet({
      // Swagger UI needs inline styles/scripts, which a strict default CSP blocks.
      contentSecurityPolicy: application.isProduction ? undefined : false,
      crossOriginEmbedderPolicy: false,
    }),
  );
  app.use(compression());

  app.enableCors({
    origin: application.corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-request-id'],
    exposedHeaders: ['x-request-id'],
    maxAge: 86400,
  });

  const globalPrefix = application.apiPrefix;
  app.setGlobalPrefix(globalPrefix, {
    // Probes stay at a stable, unversioned path for orchestrators.
    exclude: [],
  });

  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: application.apiVersion,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      // Strip unknown properties, and reject rather than silently ignore them,
      // so a typo'd field never passes unnoticed.
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
      validateCustomDecorators: true,
      stopAtFirstError: false,
    }),
  );

  if (swagger.enabled && !application.isProduction) {
    configureSwagger(app, swagger, globalPrefix);
  }

  // Socket.IO, fanned out over Redis so events reach clients connected to any
  // instance. Installed before listen, and tolerant of a Redis that is not
  // there: a single instance still works, it simply cannot broadcast to others.
  const socketAdapter = new RedisIoAdapter(
    app,
    app.get(RedisService).getClient(),
    application,
    logger,
  );
  await socketAdapter.connect();
  app.useWebSocketAdapter(socketAdapter);

  // Lets Nest run `onModuleDestroy` hooks on SIGTERM, so Prisma and Redis
  // close cleanly instead of dropping in-flight work.
  app.enableShutdownHooks();

  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
      logger.log?.(`Received ${signal}, shutting down gracefully…`, 'Bootstrap');
      // A hung dependency must not leave the container un-killable; if the
      // orderly close has not finished in time, exit anyway.
      const failsafe = setTimeout(() => {
        logger.error?.('Graceful shutdown timed out, forcing exit', undefined, 'Bootstrap');
        process.exit(1);
      }, application.shutdownTimeoutMs);
      failsafe.unref();

      void app.close().then(() => {
        clearTimeout(failsafe);
        logger.log?.('Shutdown complete', 'Bootstrap');
      });
    });
  }

  const server = await app.listen(application.port, '0.0.0.0');

  // Keep-alive must outlive a typical load balancer's idle timeout, otherwise
  // the balancer can reuse a socket the server is already closing and the
  // client sees a sporadic 502.
  server.keepAliveTimeout = 65000;
  server.headersTimeout = 66000;

  const baseUrl = `http://localhost:${application.port}/${globalPrefix}/v${application.apiVersion}`;
  logger.log?.(`ZassDelivery API listening on ${baseUrl}`, 'Bootstrap');
  logger.log?.(`Environment: ${application.nodeEnv}`, 'Bootstrap');
  if (swagger.enabled && !application.isProduction) {
    logger.log?.(
      `Swagger UI: http://localhost:${application.port}/${globalPrefix}/${swagger.path}`,
      'Bootstrap',
    );
  }
}

void bootstrap();
