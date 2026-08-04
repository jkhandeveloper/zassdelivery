import { Injectable } from '@nestjs/common';
import {
  AssignmentStatus,
  DriverAvailability,
  DriverDocumentStatus,
  DriverStatus,
  Prisma,
  type DeliveryAssignment,
  type DriverDocument,
} from '@prisma/client';

import type { PaginatedResult } from '@/common/interfaces/paginated-result.interface';
import { paginate } from '@/common/utils/pagination.util';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';

import {
  RiderRepository,
  type ListRidersFilter,
  type RegisterRiderInput,
  type RiderWithDetails,
  type SetRiderStatusInput,
  type UpdateRiderInput,
  type UpsertDocumentInput,
} from '../../domain/repositories/rider.repository';

const DETAILS = {
  user: {
    select: { id: true, fullName: true, phone: true, email: true, avatarUrl: true, status: true },
  },
  zone: { select: { id: true, name: true } },
  vehicles: { orderBy: { isPrimary: 'desc' } },
  documents: { orderBy: { type: 'asc' } },
} satisfies Prisma.DriverInclude;

@Injectable()
export class PrismaRiderRepository extends RiderRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async findMany(filter: ListRidersFilter): Promise<PaginatedResult<RiderWithDetails>> {
    const where: Prisma.DriverWhereInput = {
      deletedAt: null,
      ...(filter.status && { status: filter.status }),
      ...(filter.availability && { availability: filter.availability }),
      ...(filter.zoneId && { zoneId: filter.zoneId }),
      ...(filter.search && {
        OR: [
          { cnic: { contains: filter.search.replace(/\D/g, '') } },
          { user: { fullName: { contains: filter.search, mode: 'insensitive' } } },
          { user: { phone: { contains: filter.search } } },
        ],
      }),
    };

    const [total, items] = await this.prisma.$transaction([
      this.prisma.driver.count({ where }),
      this.prisma.driver.findMany({
        where,
        include: DETAILS,
        orderBy: filter.orderBy,
        skip: (filter.page - 1) * filter.limit,
        take: filter.limit,
      }),
    ]);

    return paginate(items, total, filter.page, filter.limit);
  }

  async findById(id: string): Promise<RiderWithDetails | null> {
    return this.prisma.driver.findFirst({ where: { id, deletedAt: null }, include: DETAILS });
  }

  async findByUserId(userId: string): Promise<RiderWithDetails | null> {
    return this.prisma.driver.findFirst({ where: { userId, deletedAt: null }, include: DETAILS });
  }

  async existsByCnic(cnic: string): Promise<boolean> {
    const found = await this.prisma.driver.findUnique({ where: { cnic }, select: { id: true } });

    return found !== null;
  }

  async register(input: RegisterRiderInput): Promise<RiderWithDetails> {
    // Profile, vehicle and wallet land together. A rider whose wallet only
    // appears on their first payout would fail at the worst possible moment —
    // standing on a doorstep with the delivery already made.
    return this.prisma.$transaction(async (tx) => {
      const driver = await tx.driver.create({
        data: {
          userId: input.userId,
          cnic: input.cnic,
          licenseNumber: input.licenseNumber,
          zoneId: input.zoneId,
          status: DriverStatus.PENDING_APPROVAL,
          availability: DriverAvailability.OFFLINE,
          payoutBankName: input.payout.bankName,
          payoutAccountTitle: input.payout.accountTitle,
          payoutAccountNumber: input.payout.accountNumber,
        },
      });

      await tx.vehicle.create({
        data: {
          driverId: driver.id,
          type: input.vehicle.type,
          make: input.vehicle.make,
          model: input.vehicle.model,
          year: input.vehicle.year,
          color: input.vehicle.color,
          plateNumber: input.vehicle.plateNumber,
          isPrimary: true,
        },
      });

      await tx.wallet.upsert({
        where: { userId: input.userId },
        update: {},
        create: { userId: input.userId },
      });

      return tx.driver.findUniqueOrThrow({ where: { id: driver.id }, include: DETAILS });
    });
  }

  async update(id: string, input: UpdateRiderInput): Promise<RiderWithDetails> {
    return this.prisma.driver.update({ where: { id }, data: input, include: DETAILS });
  }

  async setStatus(id: string, input: SetRiderStatusInput): Promise<RiderWithDetails> {
    return this.prisma.$transaction(async (tx) => {
      // Losing approval takes the rider off the map as well as off the roster;
      // a suspended rider left ONLINE would keep surfacing as a dispatch
      // candidate.
      const availability =
        input.status === DriverStatus.ACTIVE ? undefined : DriverAvailability.OFFLINE;

      await tx.driver.update({
        where: { id },
        data: {
          status: input.status,
          rejectionReason: input.rejectionReason ?? null,
          approvedById: input.reviewerId,
          ...(availability !== undefined && { availability, onlineSince: null }),
          ...(input.verified === true && { verifiedAt: new Date() }),
        },
      });

      return tx.driver.findUniqueOrThrow({ where: { id }, include: DETAILS });
    });
  }

  async setAvailability(
    id: string,
    availability: DriverAvailability,
    location?: { latitude: number; longitude: number } | null,
  ): Promise<RiderWithDetails> {
    const goingOnline = availability === DriverAvailability.ONLINE;

    return this.prisma.driver.update({
      where: { id },
      data: {
        availability,
        // The online clock starts when a shift starts and stops when it ends,
        // so shift length never has to be reconstructed from an event log.
        onlineSince: goingOnline ? new Date() : null,
        ...(location && {
          currentLat: location.latitude,
          currentLng: location.longitude,
          lastLocationAt: new Date(),
        }),
      },
      include: DETAILS,
    });
  }

  async updateLocation(id: string, latitude: number, longitude: number): Promise<void> {
    await this.prisma.driver.update({
      where: { id },
      data: { currentLat: latitude, currentLng: longitude, lastLocationAt: new Date() },
    });
  }

  async listDocuments(driverId: string): Promise<DriverDocument[]> {
    return this.prisma.driverDocument.findMany({ where: { driverId }, orderBy: { type: 'asc' } });
  }

  async upsertDocument(input: UpsertDocumentInput): Promise<DriverDocument> {
    return this.prisma.driverDocument.upsert({
      where: { driverId_type: { driverId: input.driverId, type: input.type } },
      // A replacement always re-enters the queue: the previous review said
      // nothing about this file, and carrying the old verdict over would let a
      // rejected document be laundered into a verified one.
      update: {
        fileUrl: input.fileUrl,
        number: input.number,
        expiresAt: input.expiresAt,
        status: DriverDocumentStatus.PENDING,
        rejectionReason: null,
        reviewedById: null,
        reviewedAt: null,
      },
      create: {
        driverId: input.driverId,
        type: input.type,
        fileUrl: input.fileUrl,
        number: input.number,
        expiresAt: input.expiresAt,
      },
    });
  }

  async reviewDocument(
    documentId: string,
    input: {
      status: DriverDocumentStatus;
      reviewerId: string;
      rejectionReason?: string | null;
    },
  ): Promise<DriverDocument> {
    return this.prisma.driverDocument.update({
      where: { id: documentId },
      data: {
        status: input.status,
        rejectionReason: input.rejectionReason ?? null,
        reviewedById: input.reviewerId,
        reviewedAt: new Date(),
      },
    });
  }

  async findDocument(documentId: string): Promise<(DriverDocument & { driverId: string }) | null> {
    return this.prisma.driverDocument.findUnique({ where: { id: documentId } });
  }

  async findDispatchCandidates(orderId: string): Promise<
    Array<{
      driverId: string;
      zoneId: string | null;
      currentLat: number | null;
      currentLng: number | null;
      lastLocationAt: Date | null;
      rating: number;
      hasRejectedThisOrder: boolean;
    }>
  > {
    // Every filter that can be expressed in SQL is: ranking is cheap, but
    // dragging every rider in the city into memory to discard most of them is
    // not. The zone is a preference rather than a filter, so it is not in the
    // WHERE clause — a neighbouring rider who is closer should still win.
    const candidates = await this.prisma.driver.findMany({
      where: {
        deletedAt: null,
        status: DriverStatus.ACTIVE,
        availability: DriverAvailability.ONLINE,
        // Not already carrying something.
        assignments: {
          none: { status: { in: [AssignmentStatus.OFFERED, AssignmentStatus.ACCEPTED] } },
        },
      },
      select: {
        id: true,
        zoneId: true,
        currentLat: true,
        currentLng: true,
        lastLocationAt: true,
        rating: true,
        assignments: {
          where: { orderId, status: AssignmentStatus.REJECTED },
          select: { id: true },
          take: 1,
        },
      },
      // A cap keeps a busy evening from loading the whole roster; ranking only
      // ever picks one, and the nearest rider is reliably inside this many.
      take: 50,
    });

    return candidates.map((candidate) => ({
      driverId: candidate.id,
      zoneId: candidate.zoneId,
      currentLat: candidate.currentLat,
      currentLng: candidate.currentLng,
      lastLocationAt: candidate.lastLocationAt,
      rating: Number(candidate.rating),
      hasRejectedThisOrder: candidate.assignments.length > 0,
    }));
  }

  async findActiveAssignment(driverId: string): Promise<DeliveryAssignment | null> {
    return this.prisma.deliveryAssignment.findFirst({
      where: { driverId, status: AssignmentStatus.ACCEPTED },
    });
  }

  async countDeliveries(driverId: string): Promise<number> {
    return this.prisma.deliveryAssignment.count({
      where: { driverId, status: AssignmentStatus.COMPLETED },
    });
  }
}
