import { Injectable } from '@nestjs/common';
import type { Address, Prisma } from '@prisma/client';

import { EARTH_RADIUS_METRES } from '@/common/constants/app.constants';
import type { PaginatedResult } from '@/common/interfaces/paginated-result.interface';
import { paginate } from '@/common/utils/pagination.util';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';

import {
  AddressRepository,
  type AddressInput,
  type ListAddressesFilter,
  type ZoneMatch,
} from '../../domain/repositories/address.repository';

@Injectable()
export class PrismaAddressRepository extends AddressRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async findMany(filter: ListAddressesFilter): Promise<PaginatedResult<Address>> {
    const where: Prisma.AddressWhereInput = {
      userId: filter.userId,
      deletedAt: null,
      ...(filter.label !== undefined && { label: filter.label }),
      ...(filter.search !== undefined &&
        filter.search.length > 0 && {
          OR: [
            { line1: { contains: filter.search, mode: 'insensitive' } },
            { landmark: { contains: filter.search, mode: 'insensitive' } },
          ],
        }),
    };

    const [total, items] = await this.prisma.$transaction([
      this.prisma.address.count({ where }),
      this.prisma.address.findMany({
        where,
        // The default address is always first regardless of the requested sort:
        // it is the one the checkout screen preselects.
        orderBy: [{ isDefault: 'desc' }, filter.orderBy],
        skip: (filter.page - 1) * filter.limit,
        take: filter.limit,
      }),
    ]);

    return paginate(items, total, filter.page, filter.limit);
  }

  async findById(id: string): Promise<Address | null> {
    return this.prisma.address.findUnique({ where: { id } });
  }

  async create(userId: string, input: AddressInput): Promise<Address> {
    if (input.isDefault !== true) {
      return this.prisma.address.create({ data: { userId, ...input } });
    }

    // Demoting the incumbent and inserting the new default must be atomic: a
    // partial unique index permits only one default per user, so two separate
    // statements would briefly violate it and fail.
    return this.prisma.$transaction(async (tx) => {
      await tx.address.updateMany({
        where: { userId, isDefault: true, deletedAt: null },
        data: { isDefault: false },
      });

      return tx.address.create({ data: { userId, ...input, isDefault: true } });
    });
  }

  async update(id: string, input: Partial<AddressInput>): Promise<Address> {
    return this.prisma.address.update({ where: { id }, data: input });
  }

  async softDelete(id: string): Promise<void> {
    // Clearing isDefault matters: the partial unique index ignores deleted rows,
    // but leaving the flag set would make the next default look like a conflict
    // to anything that reads the column without filtering on deletedAt.
    await this.prisma.address.update({
      where: { id },
      data: { deletedAt: new Date(), isDefault: false },
    });
  }

  async countForUser(userId: string): Promise<number> {
    return this.prisma.address.count({ where: { userId, deletedAt: null } });
  }

  async setDefault(userId: string, addressId: string): Promise<Address> {
    return this.prisma.$transaction(async (tx) => {
      await tx.address.updateMany({
        where: { userId, isDefault: true, deletedAt: null, id: { not: addressId } },
        data: { isDefault: false },
      });

      return tx.address.update({ where: { id: addressId }, data: { isDefault: true } });
    });
  }

  /**
   * Finds the active zone whose service radius contains the point.
   *
   * Distance is computed with the Haversine formula in SQL. There are only a
   * handful of zones per city, so scanning them is cheaper than the PostGIS
   * dependency a spatial index would require — and a plain query keeps the
   * deployment to a stock `postgres:16` image.
   */
  async resolveZone(latitude: number, longitude: number): Promise<ZoneMatch | null> {
    const rows = await this.prisma.$queryRaw<
      Array<{ id: string; city_id: string; name: string; distance_meters: number }>
    >`
      SELECT
        z.id,
        z.city_id,
        z.name,
        (${EARTH_RADIUS_METRES} * 2 * ASIN(SQRT(
          POWER(SIN(RADIANS(${latitude} - z.center_lat) / 2), 2) +
          COS(RADIANS(z.center_lat)) * COS(RADIANS(${latitude}::double precision)) *
          POWER(SIN(RADIANS(${longitude} - z.center_lng) / 2), 2)
        ))) AS distance_meters
      FROM zones z
      JOIN cities c ON c.id = z.city_id
      WHERE z.is_active = true AND c.is_active = true
      ORDER BY distance_meters ASC
      LIMIT 1
    `;

    const nearest = rows[0];

    if (!nearest) {
      return null;
    }

    // The nearest zone still has to actually cover the point.
    const zone = await this.prisma.zone.findUnique({
      where: { id: nearest.id },
      select: { radiusMeters: true },
    });

    if (!zone || nearest.distance_meters > zone.radiusMeters) {
      return null;
    }

    return {
      id: nearest.id,
      cityId: nearest.city_id,
      name: nearest.name,
      distanceMeters: Math.round(nearest.distance_meters),
    };
  }
}
