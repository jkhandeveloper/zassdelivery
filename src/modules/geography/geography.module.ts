import { Module } from '@nestjs/common';

import { ListZonesUseCase } from './application/use-cases/zones.use-cases';
import { ZoneRepository } from './domain/repositories/zone.repository';
import { PrismaZoneRepository } from './infrastructure/repositories/prisma-zone.repository';
import { ZonesController } from './zones.controller';

/**
 * Cities and delivery zones — the geography every other module prices and
 * routes against, published read-only for clients that need to know where the
 * service area actually is.
 */
@Module({
  controllers: [ZonesController],
  providers: [ListZonesUseCase, { provide: ZoneRepository, useClass: PrismaZoneRepository }],
  exports: [ZoneRepository],
})
export class GeographyModule {}
