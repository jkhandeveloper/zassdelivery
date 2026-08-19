import { Injectable } from '@nestjs/common';

import { ZoneRepository } from '../../domain/repositories/zone.repository';
import { toZoneDto, type ZoneDto } from '../dto/zone-response.dto';

@Injectable()
export class ListZonesUseCase {
  constructor(private readonly zones: ZoneRepository) {}

  async execute(): Promise<ZoneDto[]> {
    const zones = await this.zones.findServiceable();

    return zones.map(toZoneDto);
  }
}
