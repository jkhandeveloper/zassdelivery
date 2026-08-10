import { Injectable } from '@nestjs/common';
import { Prisma, type Banner, type Coupon, type Setting } from '@prisma/client';

import type { PaginatedResult } from '@/common/interfaces/paginated-result.interface';
import { paginate } from '@/common/utils/pagination.util';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';

import {
  BannerRepository,
  CouponRepository,
  SettingRepository,
  type BannerInput,
  type CouponInput,
  type ListBannersFilter,
  type ListCouponsFilter,
  type SettingInput,
} from '../../domain/repositories/admin.repository';

@Injectable()
export class PrismaCouponRepository extends CouponRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async findMany(filter: ListCouponsFilter): Promise<PaginatedResult<Coupon>> {
    const now = filter.now ?? new Date();

    const where: Prisma.CouponWhereInput = {
      ...(filter.type && { type: filter.type }),
      ...(filter.isActive !== undefined && { isActive: filter.isActive }),
      ...(filter.restaurantId && { restaurantId: filter.restaurantId }),
      ...(filter.search && {
        OR: [
          { code: { contains: filter.search, mode: 'insensitive' } },
          { description: { contains: filter.search, mode: 'insensitive' } },
        ],
      }),
      // "Live" is three conditions, not one flag: active, inside its window, and
      // not exhausted. A coupon can be all of `isActive` and still unusable.
      ...(filter.liveOnly === true && {
        isActive: true,
        startsAt: { lte: now },
        expiresAt: { gt: now },
      }),
    };

    const [total, items] = await this.prisma.$transaction([
      this.prisma.coupon.count({ where }),
      this.prisma.coupon.findMany({
        where,
        orderBy: filter.orderBy,
        skip: (filter.page - 1) * filter.limit,
        take: filter.limit,
      }),
    ]);

    return paginate(items, total, filter.page, filter.limit);
  }

  async findById(id: string): Promise<Coupon | null> {
    return this.prisma.coupon.findUnique({ where: { id } });
  }

  async findByCode(code: string): Promise<Coupon | null> {
    return this.prisma.coupon.findUnique({ where: { code } });
  }

  async create(input: CouponInput): Promise<Coupon> {
    return this.prisma.coupon.create({ data: input });
  }

  async update(id: string, input: Partial<CouponInput>): Promise<Coupon> {
    return this.prisma.coupon.update({ where: { id }, data: input });
  }

  async setActive(id: string, isActive: boolean): Promise<Coupon> {
    return this.prisma.coupon.update({ where: { id }, data: { isActive } });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.coupon.delete({ where: { id } });
  }

  async redemptionCount(id: string): Promise<number> {
    return this.prisma.couponRedemption.count({ where: { couponId: id } });
  }
}

@Injectable()
export class PrismaBannerRepository extends BannerRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async findMany(filter: ListBannersFilter): Promise<PaginatedResult<Banner>> {
    const now = filter.now ?? new Date();

    const where: Prisma.BannerWhereInput = {
      ...(filter.placement && { placement: filter.placement }),
      ...(filter.isActive !== undefined && { isActive: filter.isActive }),
      // A city filter includes the banners with no city at all: those run
      // everywhere, and excluding them would empty the carousel outside the
      // cities that happen to have their own artwork.
      ...(filter.cityId && { OR: [{ cityId: filter.cityId }, { cityId: null }] }),
      ...(filter.liveOnly === true && {
        isActive: true,
        AND: [
          { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
          { OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
        ],
      }),
    };

    const [total, items] = await this.prisma.$transaction([
      this.prisma.banner.count({ where }),
      this.prisma.banner.findMany({
        where,
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
        skip: (filter.page - 1) * filter.limit,
        take: filter.limit,
      }),
    ]);

    return paginate(items, total, filter.page, filter.limit);
  }

  async findById(id: string): Promise<Banner | null> {
    return this.prisma.banner.findUnique({ where: { id } });
  }

  async create(input: BannerInput): Promise<Banner> {
    return this.prisma.banner.create({ data: input });
  }

  async update(id: string, input: Partial<BannerInput>): Promise<Banner> {
    return this.prisma.banner.update({ where: { id }, data: input });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.banner.delete({ where: { id } });
  }

  async reorder(entries: Array<{ id: string; sortOrder: number }>): Promise<Banner[]> {
    // One transaction, because a half-applied reorder leaves two banners
    // claiming the same slot and the carousel ordering becomes arbitrary.
    return this.prisma.$transaction(async (tx) => {
      for (const entry of entries) {
        await tx.banner.update({ where: { id: entry.id }, data: { sortOrder: entry.sortOrder } });
      }

      return tx.banner.findMany({
        where: { id: { in: entries.map((entry) => entry.id) } },
        orderBy: { sortOrder: 'asc' },
      });
    });
  }
}

@Injectable()
export class PrismaSettingRepository extends SettingRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async findMany(filter: { group?: string; publicOnly?: boolean }): Promise<Setting[]> {
    return this.prisma.setting.findMany({
      where: {
        ...(filter.group && { group: filter.group }),
        ...(filter.publicOnly === true && { isPublic: true }),
      },
      orderBy: [{ group: 'asc' }, { key: 'asc' }],
    });
  }

  async findByKey(key: string): Promise<Setting | null> {
    return this.prisma.setting.findUnique({ where: { key } });
  }

  async upsert(input: SettingInput): Promise<Setting> {
    return this.prisma.setting.upsert({
      where: { key: input.key },
      update: {
        value: input.value,
        valueType: input.valueType,
        group: input.group,
        description: input.description,
        isPublic: input.isPublic,
        updatedById: input.updatedById,
      },
      create: input,
    });
  }

  async upsertMany(inputs: SettingInput[]): Promise<Setting[]> {
    // Together, because related settings are meaningless apart: a quiet-hours
    // start applied without its end is a window nobody configured.
    return this.prisma.$transaction(
      inputs.map((input) =>
        this.prisma.setting.upsert({
          where: { key: input.key },
          update: {
            value: input.value,
            valueType: input.valueType,
            group: input.group,
            description: input.description,
            isPublic: input.isPublic,
            updatedById: input.updatedById,
          },
          create: input,
        }),
      ),
    );
  }

  async delete(key: string): Promise<void> {
    await this.prisma.setting.delete({ where: { key } });
  }

  async groups(): Promise<string[]> {
    const grouped = await this.prisma.setting.groupBy({ by: ['group'], orderBy: { group: 'asc' } });

    return grouped.map((row) => row.group);
  }
}
