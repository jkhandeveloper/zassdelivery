import { Injectable } from '@nestjs/common';
import type { Coupon } from '@prisma/client';

import { haversineMetres } from '@/common/utils/geo.util';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';

import {
  CartCouponRepository,
  DeliveryPricingRepository,
  type DeliveryQuote,
} from '../../domain/repositories/cart.repository';

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

    const zone = await this.prisma.zone.findUnique({
      where: { id: zoneId },
      select: { deliveryFee: true, etaMinutes: true, isActive: true },
    });

    if (!zone || !zone.isActive) {
      return null;
    }

    // The matching distance band wins; the zone's flat fee is the fallback when
    // the distance falls outside every configured band.
    const band = await this.prisma.deliveryFee.findFirst({
      where: {
        zoneId,
        isActive: true,
        minDistanceKm: { lte: distanceKm },
        maxDistanceKm: { gte: distanceKm },
      },
      orderBy: { minDistanceKm: 'desc' },
    });

    if (!band) {
      return {
        fee: Number(zone.deliveryFee),
        freeDeliveryThreshold: null,
        distanceKm: Math.round(distanceKm * 100) / 100,
        etaMinutes: zone.etaMinutes,
        zoneId,
      };
    }

    // Per-km charges apply only to the distance beyond where the band starts,
    // so a 6.1 km trip is not billed as though all six kilometres were extra.
    const beyondBandStart = Math.max(0, distanceKm - Number(band.minDistanceKm));
    const fee = Number(band.baseFee) + Number(band.perKmFee) * beyondBandStart;

    return {
      fee: Math.round(fee * 100) / 100,
      freeDeliveryThreshold:
        band.freeDeliveryThreshold === null ? null : Number(band.freeDeliveryThreshold),
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
