import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { RealtimeService } from './application/realtime.service';
import { RealtimeAccessRepository } from './domain/repositories/realtime-access.repository';
import { PrismaRealtimeAccessRepository } from './infrastructure/prisma-realtime-access.repository';
import { SocketAuthenticator } from './infrastructure/socket-authenticator';
import { RealtimeController } from './realtime.controller';
import { RealtimeGateway } from './realtime.gateway';

@Module({
  // AuthModule supplies JwtService, so a socket is authenticated with exactly
  // the same token, secret and deny-list as an HTTP request.
  //
  // Nothing else is imported, and that is deliberate: orders, riders and
  // notifications all publish *into* realtime. If realtime imported them back
  // the graph would be circular, and it would be carrying nothing but four
  // authorisation questions that are a single query each — which is what
  // RealtimeAccessRepository answers instead.
  imports: [AuthModule],
  controllers: [RealtimeController],
  providers: [
    RealtimeGateway,
    RealtimeService,
    SocketAuthenticator,
    { provide: RealtimeAccessRepository, useClass: PrismaRealtimeAccessRepository },
  ],
  // RealtimeService is the one way anything reaches a live client, so every
  // module that has news imports this rather than touching Socket.IO.
  exports: [RealtimeService],
})
export class RealtimeModule {}
