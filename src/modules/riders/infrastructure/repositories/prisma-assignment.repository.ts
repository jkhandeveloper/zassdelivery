import { Injectable } from '@nestjs/common';
import { AssignmentStatus, DriverAvailability, Prisma } from '@prisma/client';

import { BusinessRuleViolationException } from '@/common/exceptions/domain.exception';
import type { PaginatedResult } from '@/common/interfaces/paginated-result.interface';
import { paginate } from '@/common/utils/pagination.util';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';

import {
  AssignmentRepository,
  type AssignmentWithOrder,
  type CreateAssignmentInput,
  type ListAssignmentsFilter,
} from '../../domain/repositories/assignment.repository';

const ORDER_CONTEXT = {
  select: {
    id: true,
    orderNumber: true,
    status: true,
    type: true,
    totalAmount: true,
    tipAmount: true,
    paymentMethod: true,
    paymentStatus: true,
    distanceKm: true,
    deliveryLine1: true,
    deliveryLandmark: true,
    deliveryLat: true,
    deliveryLng: true,
    deliveryNotes: true,
    recipientName: true,
    recipientPhone: true,
    customerId: true,
    estimatedDeliveryAt: true,
    restaurant: {
      select: {
        id: true,
        name: true,
        phone: true,
        addressLine: true,
        latitude: true,
        longitude: true,
      },
    },
    customer: { select: { fullName: true, phone: true } },
  },
} satisfies Prisma.DeliveryAssignmentInclude['order'];

const DETAILS = { order: ORDER_CONTEXT } satisfies Prisma.DeliveryAssignmentInclude;

/** Assignment states in which an order or a rider is still committed. */
const LIVE_STATUSES: AssignmentStatus[] = [AssignmentStatus.OFFERED, AssignmentStatus.ACCEPTED];

@Injectable()
export class PrismaAssignmentRepository extends AssignmentRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async findMany(filter: ListAssignmentsFilter): Promise<PaginatedResult<AssignmentWithOrder>> {
    const where: Prisma.DeliveryAssignmentWhereInput = {
      ...(filter.driverId && { driverId: filter.driverId }),
      ...(filter.orderId && { orderId: filter.orderId }),
      ...(filter.status && { status: filter.status }),
      ...(filter.liveOnly === true && {
        status: AssignmentStatus.OFFERED,
        expiresAt: { gt: new Date() },
      }),
      ...((filter.from || filter.to) && {
        offeredAt: {
          ...(filter.from && { gte: filter.from }),
          ...(filter.to && { lte: filter.to }),
        },
      }),
    };

    const [total, items] = await this.prisma.$transaction([
      this.prisma.deliveryAssignment.count({ where }),
      this.prisma.deliveryAssignment.findMany({
        where,
        include: DETAILS,
        orderBy: filter.orderBy,
        skip: (filter.page - 1) * filter.limit,
        take: filter.limit,
      }),
    ]);

    return paginate(items, total, filter.page, filter.limit);
  }

  async findById(id: string): Promise<AssignmentWithOrder | null> {
    return this.prisma.deliveryAssignment.findUnique({ where: { id }, include: DETAILS });
  }

  async findForOrderAndDriver(
    orderId: string,
    driverId: string,
  ): Promise<AssignmentWithOrder | null> {
    return this.prisma.deliveryAssignment.findFirst({
      where: { orderId, driverId, status: { in: LIVE_STATUSES } },
      include: DETAILS,
      orderBy: { offeredAt: 'desc' },
    });
  }

  async offer(input: CreateAssignmentInput): Promise<AssignmentWithOrder> {
    try {
      return await this.prisma.deliveryAssignment.create({
        data: {
          orderId: input.orderId,
          driverId: input.driverId,
          expiresAt: input.expiresAt,
          pickupDistanceKm: input.pickupDistanceKm,
          estimatedEarning: input.estimatedEarning,
          assignedById: input.assignedById,
          isAuto: input.isAuto,
        },
        include: DETAILS,
      });
    } catch (error) {
      // The partial unique indexes are the real guard: two dispatchers clicking
      // at the same instant both pass every application-level check, and one of
      // them loses here rather than producing a double-assigned order.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new BusinessRuleViolationException(
          'This order or rider was assigned a moment ago. Refresh the dispatch board and try again.',
        );
      }

      throw error;
    }
  }

  async accept(assignmentId: string): Promise<AssignmentWithOrder> {
    return this.prisma.$transaction(async (tx) => {
      // Conditional update rather than read-then-write: the WHERE clause is
      // what makes two taps on a flaky connection idempotent instead of a race.
      const claimed = await tx.deliveryAssignment.updateMany({
        where: {
          id: assignmentId,
          status: AssignmentStatus.OFFERED,
          expiresAt: { gt: new Date() },
        },
        data: { status: AssignmentStatus.ACCEPTED, respondedAt: new Date() },
      });

      if (claimed.count === 0) {
        throw new BusinessRuleViolationException(
          'This offer is no longer available — it expired or was answered already.',
        );
      }

      const assignment = await tx.deliveryAssignment.findUniqueOrThrow({
        where: { id: assignmentId },
      });

      // Any other offer of the same order is now moot; leaving them open would
      // let a second rider accept an order that already has one.
      await tx.deliveryAssignment.updateMany({
        where: {
          orderId: assignment.orderId,
          id: { not: assignmentId },
          status: AssignmentStatus.OFFERED,
        },
        data: {
          status: AssignmentStatus.CANCELLED,
          respondedAt: new Date(),
          rejectionReason: 'Another rider accepted this order first',
        },
      });

      await tx.order.update({
        where: { id: assignment.orderId },
        data: { driverId: assignment.driverId },
      });

      await tx.driver.update({
        where: { id: assignment.driverId },
        data: { availability: DriverAvailability.ON_DELIVERY },
      });

      return tx.deliveryAssignment.findUniqueOrThrow({
        where: { id: assignmentId },
        include: DETAILS,
      });
    });
  }

  async reject(assignmentId: string, reason: string | null): Promise<AssignmentWithOrder> {
    return this.prisma.deliveryAssignment.update({
      where: { id: assignmentId },
      data: {
        status: AssignmentStatus.REJECTED,
        respondedAt: new Date(),
        rejectionReason: reason,
      },
      include: DETAILS,
    });
  }

  async cancel(assignmentId: string, reason: string): Promise<AssignmentWithOrder> {
    return this.prisma.$transaction(async (tx) => {
      const assignment = await tx.deliveryAssignment.update({
        where: { id: assignmentId },
        data: {
          status: AssignmentStatus.CANCELLED,
          respondedAt: new Date(),
          rejectionReason: reason,
        },
      });

      // The order goes back on the board, and the rider back into the pool.
      await tx.order.updateMany({
        where: { id: assignment.orderId, driverId: assignment.driverId },
        data: { driverId: null },
      });

      await tx.driver.updateMany({
        where: { id: assignment.driverId, availability: DriverAvailability.ON_DELIVERY },
        data: { availability: DriverAvailability.ONLINE },
      });

      return tx.deliveryAssignment.findUniqueOrThrow({
        where: { id: assignmentId },
        include: DETAILS,
      });
    });
  }

  async expireStale(now: Date): Promise<number> {
    const result = await this.prisma.deliveryAssignment.updateMany({
      where: { status: AssignmentStatus.OFFERED, expiresAt: { lte: now } },
      data: { status: AssignmentStatus.EXPIRED, respondedAt: now },
    });

    return result.count;
  }

  async storeOtp(assignmentId: string, hash: string, issuedAt: Date): Promise<void> {
    await this.prisma.deliveryAssignment.update({
      where: { id: assignmentId },
      data: { otpHash: hash, otpIssuedAt: issuedAt, otpAttempts: 0, otpVerifiedAt: null },
    });
  }

  async recordOtpFailure(assignmentId: string): Promise<void> {
    await this.prisma.deliveryAssignment.update({
      where: { id: assignmentId },
      data: { otpAttempts: { increment: 1 } },
    });
  }

  async complete(assignmentId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const assignment = await tx.deliveryAssignment.update({
        where: { id: assignmentId },
        data: {
          status: AssignmentStatus.COMPLETED,
          completedAt: new Date(),
          otpVerifiedAt: new Date(),
        },
      });

      // The rider is free again, and their delivery count reflects the run they
      // just finished — both are part of "this delivery is over".
      await tx.driver.update({
        where: { id: assignment.driverId },
        data: {
          availability: DriverAvailability.ONLINE,
          totalDeliveries: { increment: 1 },
        },
      });
    });
  }
}
