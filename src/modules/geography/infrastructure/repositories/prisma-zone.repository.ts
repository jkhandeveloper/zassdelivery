import { Injectable } from '@nestjs/common';

import { PrismaService } from '@/infrastructure/prisma/prisma.service';

import { ZoneRepository, type ServiceableZone } from '../../domain/repositories/zone.repository';

@Injectable()
export class PrismaZoneRepository extends ZoneRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async findServiceable(): Promise<ServiceableZone[]> {
    const zones = await this.prisma.zone.findMany({
      where: { isActive: true, city: { isActive: true } },
      orderBy: [{ city: { name: 'asc' } }, { name: 'asc' }],
      include: {
        city: { select: { id: true, name: true, nameUr: true, slug: true, province: true } },
      },
    });

    // Decimal columns come back as Prisma Decimal objects; the wire contract is
    // a plain number, the same as every other money field in the API.
    return zones.map((zone) => ({
      id: zone.id,
      name: zone.name,
      slug: zone.slug,
      centerLat: zone.centerLat,
      centerLng: zone.centerLng,
      radiusMeters: zone.radiusMeters,
      deliveryFee: Number(zone.deliveryFee),
      minOrderAmount: Number(zone.minOrderAmount),
      etaMinutes: zone.etaMinutes,
      city: zone.city,
    }));
  }
}
