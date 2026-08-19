import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { Public } from '@/common/decorators/public.decorator';

import { ZoneDto } from './application/dto/zone-response.dto';
import { ListZonesUseCase } from './application/use-cases/zones.use-cases';

/**
 * Where ZassDelivery delivers.
 *
 * Public because it has to be: an address is only accepted when its coordinates
 * fall inside a zone, so a customer who cannot see the service area before
 * saving one is left guessing against a rejection. This is also the list the
 * signup flows use to let a rider pick a home zone.
 */
@ApiTags('Zones')
@Public()
@Controller('zones')
export class ZonesController {
  constructor(private readonly listZones: ListZonesUseCase) {}

  @Get()
  @ApiOperation({
    summary: 'List serviceable delivery zones',
    description:
      'Every active zone in an active city, with its centre, service radius and ' +
      'baseline delivery pricing. Unpaginated — the whole service area is a few ' +
      'dozen rows and clients need all of it to test a point against.',
  })
  @ApiResponse({ status: 200, type: [ZoneDto] })
  list(): Promise<ZoneDto[]> {
    return this.listZones.execute();
  }
}
