import { Injectable } from '@nestjs/common';
import {
  RestaurantStatus,
  type Prisma,
  type RestaurantHour,
  type RestaurantImage,
} from '@prisma/client';

import { EARTH_RADIUS_METRES } from '@/common/constants/app.constants';
import type { PaginatedResult } from '@/common/interfaces/paginated-result.interface';
import { paginate } from '@/common/utils/pagination.util';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';

import {
  RestaurantRepository,
  type CreateRestaurantInput,
  type HourInput,
  type ListRestaurantsFilter,
  type RestaurantWithRelations,
  type UpdateRestaurantInput,
} from '../../domain/repositories/restaurant.repository';

/** Relations every restaurant view needs. Selected, not spread, to keep rows small. */
const RELATIONS = {
  city: { select: { id: true, name: true, slug: true } },
  zone: { select: { id: true, name: true, slug: true } },
  categories: { select: { category: { select: { id: true, name: true, slug: true } } } },
  images: { orderBy: { sortOrder: 'asc' } },
  hours: true,
} satisfies Prisma.RestaurantInclude;

@Injectable()
export class PrismaRestaurantRepository extends RestaurantRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async findMany(filter: ListRestaurantsFilter): Promise<PaginatedResult<RestaurantWithRelations>> {
    const where = this.buildWhere(filter);

    // A "delivers to this point" filter compares the customer's distance
    // against each restaurant's own radius, which is a per-row computation
    // Prisma's query builder cannot express. The ids are resolved in raw SQL
    // first so the count and the page stay consistent with each other.
    if (filter.near) {
      const reachable = await this.prisma.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM restaurants
        WHERE deleted_at IS NULL
          AND (${EARTH_RADIUS_METRES} * 2 * ASIN(SQRT(
                POWER(SIN(RADIANS(${filter.near.latitude} - latitude) / 2), 2) +
                COS(RADIANS(latitude)) * COS(RADIANS(${filter.near.latitude}::double precision)) *
                POWER(SIN(RADIANS(${filter.near.longitude} - longitude) / 2), 2)
              ))) <= delivery_radius_meters
      `;

      where.id = { in: reachable.map((row) => row.id) };
    }

    const [total, items] = await this.prisma.$transaction([
      this.prisma.restaurant.count({ where }),
      this.prisma.restaurant.findMany({
        where,
        include: RELATIONS,
        // Featured listings surface first within the requested ordering.
        orderBy: [{ isFeatured: 'desc' }, filter.orderBy],
        skip: (filter.page - 1) * filter.limit,
        take: filter.limit,
      }),
    ]);

    return paginate(items, total, filter.page, filter.limit);
  }

  async findById(id: string, includeDeleted = false): Promise<RestaurantWithRelations | null> {
    const restaurant = await this.prisma.restaurant.findUnique({
      where: { id },
      include: RELATIONS,
    });

    if (!restaurant || (!includeDeleted && restaurant.deletedAt !== null)) {
      return null;
    }

    return restaurant;
  }

  async findBySlug(slug: string): Promise<RestaurantWithRelations | null> {
    const restaurant = await this.prisma.restaurant.findUnique({
      where: { slug },
      include: RELATIONS,
    });

    return restaurant && restaurant.deletedAt === null ? restaurant : null;
  }

  async slugExists(slug: string): Promise<boolean> {
    const found = await this.prisma.restaurant.findUnique({
      where: { slug },
      select: { id: true },
    });

    return found !== null;
  }

  async countForOwner(ownerId: string): Promise<number> {
    return this.prisma.restaurant.count({ where: { ownerId, deletedAt: null } });
  }

  async create(input: CreateRestaurantInput): Promise<RestaurantWithRelations> {
    const { categoryIds, ...data } = input;

    return this.prisma.restaurant.create({
      data: {
        ...data,
        // Every new listing enters the review queue; nothing goes live on its own.
        status: RestaurantStatus.PENDING_APPROVAL,
        submittedAt: new Date(),
        isAcceptingOrders: false,
        categories: { create: categoryIds.map((categoryId) => ({ categoryId })) },
      },
      include: RELATIONS,
    });
  }

  async update(id: string, input: UpdateRestaurantInput): Promise<RestaurantWithRelations> {
    const { categoryIds, ...data } = input;

    if (!categoryIds) {
      return this.prisma.restaurant.update({ where: { id }, data, include: RELATIONS });
    }

    // Category membership is replaced wholesale inside a transaction, so the
    // listing is never briefly uncategorised and therefore unfindable.
    return this.prisma.$transaction(async (tx) => {
      await tx.restaurantCategoryAssignment.deleteMany({ where: { restaurantId: id } });

      return tx.restaurant.update({
        where: { id },
        data: {
          ...data,
          categories: { create: categoryIds.map((categoryId) => ({ categoryId })) },
        },
        include: RELATIONS,
      });
    });
  }

  async softDelete(id: string): Promise<void> {
    await this.prisma.restaurant.update({
      where: { id },
      data: { deletedAt: new Date(), isAcceptingOrders: false },
    });
  }

  async setStatus(
    id: string,
    status: RestaurantStatus,
    context: { approvedById?: string; rejectionReason?: string },
  ): Promise<RestaurantWithRelations> {
    const data: Prisma.RestaurantUpdateInput = { status };

    if (status === RestaurantStatus.ACTIVE) {
      data.approvedAt = new Date();
      data.rejectionReason = null;
      // Going live turns ordering on; a freshly approved restaurant that still
      // had to flip a second switch would look broken to its owner.
      data.isAcceptingOrders = true;
    }

    if (status === RestaurantStatus.REJECTED) {
      data.rejectionReason = context.rejectionReason ?? null;
      data.isAcceptingOrders = false;
    }

    if (status === RestaurantStatus.SUSPENDED || status === RestaurantStatus.TEMPORARILY_CLOSED) {
      data.isAcceptingOrders = false;
    }

    if (status === RestaurantStatus.PENDING_APPROVAL) {
      data.submittedAt = new Date();
      data.rejectionReason = null;
      data.isAcceptingOrders = false;
    }

    if (context.approvedById) {
      data.approvedBy = { connect: { id: context.approvedById } };
    }

    return this.prisma.restaurant.update({ where: { id }, data, include: RELATIONS });
  }

  async setAcceptingOrders(id: string, accepting: boolean): Promise<RestaurantWithRelations> {
    return this.prisma.restaurant.update({
      where: { id },
      data: { isAcceptingOrders: accepting },
      include: RELATIONS,
    });
  }

  // ── Opening hours ──

  async findHours(restaurantId: string): Promise<RestaurantHour[]> {
    return this.prisma.restaurantHour.findMany({ where: { restaurantId } });
  }

  async replaceHours(restaurantId: string, hours: HourInput[]): Promise<RestaurantHour[]> {
    // Delete-then-insert in one transaction: an upsert-per-day would leave the
    // week half-updated if a later row failed validation.
    return this.prisma.$transaction(async (tx) => {
      await tx.restaurantHour.deleteMany({ where: { restaurantId } });
      await tx.restaurantHour.createMany({
        data: hours.map((hour) => ({ restaurantId, ...hour })),
      });

      return tx.restaurantHour.findMany({ where: { restaurantId } });
    });
  }

  // ── Images ──

  async findImages(restaurantId: string): Promise<RestaurantImage[]> {
    return this.prisma.restaurantImage.findMany({
      where: { restaurantId },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async addImage(
    restaurantId: string,
    input: { url: string; caption?: string | null; sortOrder: number },
  ): Promise<RestaurantImage> {
    return this.prisma.restaurantImage.create({ data: { restaurantId, ...input } });
  }

  async countImages(restaurantId: string): Promise<number> {
    return this.prisma.restaurantImage.count({ where: { restaurantId } });
  }

  async findImageById(imageId: string): Promise<RestaurantImage | null> {
    return this.prisma.restaurantImage.findUnique({ where: { id: imageId } });
  }

  async deleteImage(imageId: string): Promise<void> {
    await this.prisma.restaurantImage.delete({ where: { id: imageId } });
  }

  async reorderImages(restaurantId: string, orderedIds: string[]): Promise<RestaurantImage[]> {
    await this.prisma.$transaction(
      orderedIds.map((id, index) =>
        this.prisma.restaurantImage.update({ where: { id }, data: { sortOrder: index } }),
      ),
    );

    return this.findImages(restaurantId);
  }

  private buildWhere(filter: ListRestaurantsFilter): Prisma.RestaurantWhereInput {
    const where: Prisma.RestaurantWhereInput = {};

    if (filter.includeDeleted !== true) {
      where.deletedAt = null;
    }

    if (filter.status !== undefined) {
      where.status = filter.status;
    }

    if (filter.cityId !== undefined) {
      where.cityId = filter.cityId;
    }

    if (filter.zoneId !== undefined) {
      where.zoneId = filter.zoneId;
    }

    if (filter.ownerId !== undefined) {
      where.ownerId = filter.ownerId;
    }

    if (filter.priceRange !== undefined) {
      where.priceRange = filter.priceRange;
    }

    if (filter.minRating !== undefined) {
      where.rating = { gte: filter.minRating };
    }

    if (filter.acceptingOnly === true) {
      where.isAcceptingOrders = true;
    }

    if (filter.categorySlug !== undefined) {
      where.categories = { some: { category: { slug: filter.categorySlug } } };
    }

    if (filter.search !== undefined && filter.search.length > 0) {
      // Backed by the GIN trigram index on restaurants.name, so the leading
      // wildcard this compiles to does not force a sequential scan.
      where.OR = [
        { name: { contains: filter.search, mode: 'insensitive' } },
        { description: { contains: filter.search, mode: 'insensitive' } },
      ];
    }

    return where;
  }
}
