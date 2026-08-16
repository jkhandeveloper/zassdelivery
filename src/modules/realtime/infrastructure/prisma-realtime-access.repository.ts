import { Injectable } from '@nestjs/common';
import { AssignmentStatus, OrderStatus, UserRole } from '@prisma/client';

import { PrismaService } from '@/infrastructure/prisma/prisma.service';

import {
  RealtimeAccessRepository,
  type OrderSnapshot,
} from '../domain/repositories/realtime-access.repository';

/** Statuses in which a rider is out with an order and worth tracking. */
const IN_FLIGHT: OrderStatus[] = [
  OrderStatus.CONFIRMED,
  OrderStatus.PREPARING,
  OrderStatus.READY_FOR_PICKUP,
  OrderStatus.PICKED_UP,
  OrderStatus.ON_THE_WAY,
];

@Injectable()
export class PrismaRealtimeAccessRepository extends RealtimeAccessRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async canAccessOrder(userId: string, isStaff: boolean, orderId: string): Promise<boolean> {
    if (isStaff) {
      return true;
    }

    // One query covering all three legitimate parties. Splitting it into three
    // would be three round trips on the hottest path a socket has — every
    // customer opening the tracking screen runs this.
    const order = await this.prisma.order.findFirst({
      where: {
        id: orderId,
        OR: [{ customerId: userId }, { driver: { userId } }, { restaurant: { ownerId: userId } }],
      },
      select: { id: true },
    });

    return order !== null;
  }

  async canAccessRestaurant(
    userId: string,
    isStaff: boolean,
    restaurantId: string,
  ): Promise<boolean> {
    if (isStaff) {
      return true;
    }

    const restaurant = await this.prisma.restaurant.findFirst({
      where: { id: restaurantId, ownerId: userId, deletedAt: null },
      select: { id: true },
    });

    if (restaurant !== null) {
      return true;
    }

    // Kitchen staff do not own the listing but do work the tickets. Scoped to
    // the one restaurant they were registered against — without that check
    // any vendor's staff account could subscribe to any other restaurant's
    // board.
    const staff = await this.prisma.user.findFirst({
      where: {
        id: userId,
        role: UserRole.VENDOR_STAFF,
        staffRestaurantId: restaurantId,
        deletedAt: null,
      },
      select: { id: true },
    });

    return staff !== null;
  }

  async driverIdForUser(userId: string): Promise<string | null> {
    const driver = await this.prisma.driver.findFirst({
      where: { userId, deletedAt: null },
      select: { id: true },
    });

    return driver?.id ?? null;
  }

  async activeOrderForDriver(driverId: string): Promise<string | null> {
    const assignment = await this.prisma.deliveryAssignment.findFirst({
      where: {
        driverId,
        status: AssignmentStatus.ACCEPTED,
        order: { status: { in: IN_FLIGHT } },
      },
      select: { orderId: true },
      orderBy: { offeredAt: 'desc' },
    });

    return assignment?.orderId ?? null;
  }

  async orderSnapshot(orderId: string): Promise<OrderSnapshot | null> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        orderNumber: true,
        status: true,
        customerId: true,
        restaurantId: true,
        driverId: true,
        estimatedDeliveryAt: true,
        deliveryLat: true,
        deliveryLng: true,
        updatedAt: true,
        restaurant: { select: { name: true } },
        driver: {
          select: {
            id: true,
            currentLat: true,
            currentLng: true,
            lastLocationAt: true,
            user: { select: { fullName: true, phone: true } },
          },
        },
      },
    });

    if (order === null) {
      return null;
    }

    const rider = order.driver;

    return {
      id: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      customerId: order.customerId,
      restaurantId: order.restaurantId,
      restaurantName: order.restaurant.name,
      driverId: order.driverId,
      estimatedDeliveryAt: order.estimatedDeliveryAt,
      deliveryLat: order.deliveryLat,
      deliveryLng: order.deliveryLng,
      rider:
        rider === null
          ? null
          : { id: rider.id, name: rider.user.fullName, phone: rider.user.phone },
      riderLocation:
        rider !== null && rider.currentLat !== null && rider.currentLng !== null
          ? {
              latitude: rider.currentLat,
              longitude: rider.currentLng,
              at: rider.lastLocationAt ?? order.updatedAt,
            }
          : null,
      updatedAt: order.updatedAt,
    };
  }

  async saveDriverLocation(driverId: string, latitude: number, longitude: number): Promise<void> {
    await this.prisma.driver.update({
      where: { id: driverId },
      data: { currentLat: latitude, currentLng: longitude, lastLocationAt: new Date() },
    });
  }
}
