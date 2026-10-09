import { Injectable } from '@nestjs/common';
import type { Coupon } from '@prisma/client';

import { haversineMetres } from '@/common/utils/geo.util';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';

import {
  CartCouponRepository,
  DeliveryPricingRepository,
  type DeliveryQuote,
} from '../../domain/repositories/cart.repository';
import { DELIVERY_FEE_SETTINGS, distanceFee } from '../../domain/services/delivery-fee.policy';

@Injectable()
export class PrismaDeliveryPricingRepository extends DeliveryPricingRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async quote(
    restaurantLat: number,
    restaurantLng: number,
    restaurantRadiusMeters: number,
    addressLat: number,
    addressLng: number,
    zoneId: string,
  ): Promise<DeliveryQuote | null> {
    const distanceMeters = haversineMetres(restaurantLat, restaurantLng, addressLat, addressLng);

    // The restaurant's own radius is the hard limit: no fee band can make it
    // willing to travel further than it has said it will.
    if (distanceMeters > restaurantRadiusMeters) {
      return null;
    }

    const distanceKm = distanceMeters / 1000;

    const [perKmFee, minFee, maxFee, maxDistanceKm] = await Promise.all([
      this.numericSetting(
        DELIVERY_FEE_SETTINGS.perKmFee.key,
        DELIVERY_FEE_SETTINGS.perKmFee.fallback,
      ),
      this.numericSetting(DELIVERY_FEE_SETTINGS.minFee.key, DELIVERY_FEE_SETTINGS.minFee.fallback),
      this.numericSetting(DELIVERY_FEE_SETTINGS.maxFee.key, DELIVERY_FEE_SETTINGS.maxFee.fallback),
      this.numericSetting(
        DELIVERY_FEE_SETTINGS.maxDistanceKm.key,
        DELIVERY_FEE_SETTINGS.maxDistanceKm.fallback,
      ),
    ]);

    // Priced by the kilometre, and null past the platform's own limit — which
    // applies on top of the restaurant's radius, whichever is the shorter.
    const fee = distanceFee(distanceKm, { perKmFee, minFee, maxFee, maxDistanceKm });

    if (fee === null) {
      return null;
    }

    const zone = await this.prisma.zone.findUnique({
      where: { id: zoneId },
      select: { etaMinutes: true, isActive: true },
    });

    if (!zone || !zone.isActive) {
      return null;
    }

    // The zone's bands no longer set the fee; the one covering this distance
    // still says how large a basket has to be for delivery to be free.
    const band = await this.prisma.deliveryFee.findFirst({
      where: {
        zoneId,
        isActive: true,
        minDistanceKm: { lte: distanceKm },
        maxDistanceKm: { gte: distanceKm },
      },
      orderBy: { minDistanceKm: 'desc' },
      select: { freeDeliveryThreshold: true },
    });

    return {
      fee,
      freeDeliveryThreshold:
        band === null || band.freeDeliveryThreshold === null
          ? null
          : Number(band.freeDeliveryThreshold),
      distanceKm: Math.round(distanceKm * 100) / 100,
      etaMinutes: zone.etaMinutes,
      zoneId,
    };
  }

  async numericSetting(key: string, fallback: number): Promise<number> {
    const setting = await this.prisma.setting.findUnique({
      where: { key },
      select: { value: true },
    });

    if (!setting) {
      return fallback;
    }

    const parsed = Number(setting.value);

    // A malformed setting must not silently become NaN and poison every total
    // downstream; the documented default is safer.
    return Number.isFinite(parsed) ? parsed : fallback;
  }
}

@Injectable()
export class PrismaCartCouponRepository extends CartCouponRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async findActiveByCode(code: string): Promise<Coupon | null> {
    return this.prisma.coupon.findUnique({ where: { code } });
  }

  async countRedemptionsByUser(couponId: string, userId: string): Promise<number> {
    return this.prisma.couponRedemption.count({ where: { couponId, userId } });
  }

  async hasPlacedOrder(userId: string): Promise<boolean> {
    const found = await this.prisma.order.findFirst({
      where: { customerId: userId },
      select: { id: true },
    });

    return found !== null;
  }
}
