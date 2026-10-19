import { Injectable } from '@nestjs/common';
import { OrderType } from '@prisma/client';

import {
  CartValidationService,
  type CartIssue,
} from '../../domain/services/cart-validation.service';
import { PricingService, money, type PricedLine } from '../../domain/services/pricing.service';
import {
  DeliveryPricingRepository,
  type AvailableRider,
  type CartWithContents,
} from '../../domain/repositories/cart.repository';
import { RIDER_SEARCH_SETTINGS } from '../../domain/services/delivery-fee.policy';
import type { CartDto, CartLineDto } from '../dto/cart-response.dto';

/** Platform-wide tax setting, read from the Setting table. */
const SETTING_TAX = 'platform.tax_percentage';

/**
 * Turns a stored cart into the priced, validated view the client renders.
 *
 * Every read path goes through here — add, remove, update, apply coupon — so
 * the basket is priced by exactly one code path and the totals can never
 * disagree between endpoints.
 */
@Injectable()
export class CartAssemblerService {
  constructor(
    private readonly pricing: PricingService,
    private readonly validation: CartValidationService,
    private readonly delivery: DeliveryPricingRepository,
  ) {}

  async assemble(cart: CartWithContents): Promise<CartDto> {
    // Validated once and reused: recomputing per line would re-walk the whole
    // basket for every row.
    const issues = this.validation.validate(cart);
    const lines = this.priceLines(cart);

    // Collected over the counter: no address, no rider, nothing to deliver.
    const pickup = cart.fulfilment === OrderType.PICKUP;

    const rider =
      !pickup && cart.preferredDriverId !== null
        ? ((await this.availableRiders(cart, cart.preferredDriverId))[0] ?? null)
        : null;

    if (!pickup && cart.preferredDriverId !== null && rider === null) {
      issues.push({
        code: 'RIDER_UNAVAILABLE',
        message:
          'The rider you chose is no longer available. Choose another rider, or let us find one.',
        blocking: true,
      });
    }

    const quote =
      !pickup && cart.address !== null
        ? await this.delivery.quote(
            cart.restaurant.latitude,
            cart.restaurant.longitude,
            cart.restaurant.deliveryRadiusMeters,
            cart.address.latitude,
            cart.address.longitude,
            cart.address.zoneId ?? cart.restaurant.zoneId,
            rider?.perKmRate ?? null,
          )
        : null;

    if (!pickup && cart.address !== null && quote === null) {
      issues.push({
        code: 'OUTSIDE_DELIVERY_AREA',
        message: 'This business does not deliver to the selected address.',
        blocking: true,
      });
    }

    if (!pickup && cart.address === null) {
      issues.push({
        code: 'NO_ADDRESS',
        message: 'Choose a delivery address to see the final total.',
        blocking: true,
      });
    }

    const taxPercentage = await this.delivery.numericSetting(SETTING_TAX, 0);

    const totals = this.pricing.calculate({
      lines,
      coupon:
        cart.coupon === null
          ? null
          : {
              type: cart.coupon.type,
              value: Number(cart.coupon.value),
              maxDiscountAmount:
                cart.coupon.maxDiscountAmount === null
                  ? null
                  : Number(cart.coupon.maxDiscountAmount),
              minOrderAmount: Number(cart.coupon.minOrderAmount),
            },
      // Without an address there is no fee to quote yet, so the basket shows a
      // food-only total until one is chosen.
      baseDeliveryFee: quote?.fee ?? 0,
      freeDeliveryThreshold: quote?.freeDeliveryThreshold ?? null,
      taxPercentage,
      // The tip is the rider's, and a pickup order has no rider.
      tipAmount: pickup ? 0 : Number(cart.tipAmount),
    });

    const minimumOrder = Number(cart.restaurant.minOrderAmount);

    if (totals.subtotal > 0 && totals.subtotal < minimumOrder) {
      issues.push({
        code: 'BELOW_MINIMUM_ORDER',
        message: `This business has a minimum order of Rs. ${minimumOrder}. Add Rs. ${money(
          minimumOrder - totals.subtotal,
        )} more.`,
        blocking: true,
      });
    }

    // A coupon that no longer clears its own minimum is reported rather than
    // silently ignored — the customer applied it and expects to see why it
    // stopped counting.
    if (cart.coupon !== null && totals.subtotal < Number(cart.coupon.minOrderAmount)) {
      issues.push({
        code: 'COUPON_INVALID',
        message: `${cart.couponCode ?? 'This coupon'} needs a minimum order of Rs. ${Number(
          cart.coupon.minOrderAmount,
        )}.`,
        blocking: false,
      });
    }

    return {
      id: cart.id,
      restaurant: {
        id: cart.restaurant.id,
        name: cart.restaurant.name,
        slug: cart.restaurant.slug,
        logoUrl: cart.restaurant.logoUrl,
        minOrderAmount: minimumOrder,
        avgPreparationMinutes: cart.restaurant.avgPreparationMinutes,
        isAcceptingOrders: cart.restaurant.isAcceptingOrders,
      },
      items: this.presentLines(cart, lines, issues),
      totals,
      fulfilment: cart.fulfilment,
      rider:
        rider === null
          ? null
          : {
              id: rider.driverId,
              fullName: rider.fullName,
              avatarUrl: rider.avatarUrl,
              rating: rider.rating,
              vehicleType: rider.vehicleType,
              perKmRate: rider.perKmRate,
            },
      delivery: {
        addressId: cart.addressId,
        addressLine: cart.address?.line1 ?? null,
        distanceKm: quote?.distanceKm ?? null,
        etaMinutes: pickup
          ? cart.restaurant.avgPreparationMinutes
          : quote === null
            ? null
            : quote.etaMinutes + cart.restaurant.avgPreparationMinutes,
        isDeliverable: pickup || cart.address === null ? true : quote !== null,
      },
      couponCode: cart.couponCode,
      notes: cart.notes,
      issues,
      canCheckout: CartValidationService.blockingOnly(issues).length === 0,
      expiresAt: cart.expiresAt,
    };
  }

  /**
   * Riders free to take this cart's order, nearest the business first — or,
   * given an id, whether that one rider still is.
   */
  async availableRiders(cart: CartWithContents, driverId?: string): Promise<AvailableRider[]> {
    const [radiusKm, freshnessMinutes] = await Promise.all([
      this.delivery.numericSetting(
        RIDER_SEARCH_SETTINGS.searchRadiusKm.key,
        RIDER_SEARCH_SETTINGS.searchRadiusKm.fallback,
      ),
      this.delivery.numericSetting(
        RIDER_SEARCH_SETTINGS.locationFreshnessMinutes.key,
        RIDER_SEARCH_SETTINGS.locationFreshnessMinutes.fallback,
      ),
    ]);

    return this.delivery.findAvailableRiders({
      pickupLat: cart.restaurant.latitude,
      pickupLng: cart.restaurant.longitude,
      radiusKm,
      freshSince: new Date(Date.now() - freshnessMinutes * 60_000),
      driverId,
    });
  }

  /**
   * Prices each line from the *current* catalogue rather than from anything
   * stored on the cart. A basket must always reflect today's prices; storing
   * them at add-time would let a customer hold a stale price indefinitely.
   */
  private priceLines(cart: CartWithContents): PricedLine[] {
    return cart.items.map((line) => {
      const dishPrice =
        line.menuItem.discountedPrice === null
          ? Number(line.menuItem.basePrice)
          : Number(line.menuItem.discountedPrice);

      // A variant carries its own absolute price and overrides the dish price.
      const unitPrice = line.variant === null ? dishPrice : Number(line.variant.price);

      // Unavailable extras are excluded from the total: the customer will not
      // receive them, so charging for them would be wrong.
      const addOnsTotal = money(
        line.addOns
          .filter((entry) => entry.addOn.isAvailable)
          .reduce((sum, entry) => sum + Number(entry.addOn.price) * entry.quantity, 0),
      );

      return {
        cartItemId: line.id,
        menuItemId: line.menuItemId,
        name: line.menuItem.name,
        variantName: line.variant?.name ?? null,
        unitPrice: money(unitPrice),
        addOnsTotal,
        quantity: line.quantity,
        lineTotal: money((unitPrice + addOnsTotal) * line.quantity),
      };
    });
  }

  private presentLines(
    cart: CartWithContents,
    priced: PricedLine[],
    issues: CartIssue[],
  ): CartLineDto[] {
    const byId = new Map(priced.map((line) => [line.cartItemId, line]));
    const blockedLines = new Set(
      issues.filter((issue) => issue.blocking && issue.cartItemId).map((issue) => issue.cartItemId),
    );

    return cart.items.map((line) => {
      const price = byId.get(line.id);

      return {
        id: line.id,
        menuItemId: line.menuItemId,
        name: line.menuItem.name,
        imageUrl: line.menuItem.imageUrl,
        variantName: line.variant?.name ?? null,
        variantId: line.variantId,
        unitPrice: price?.unitPrice ?? 0,
        addOnsTotal: price?.addOnsTotal ?? 0,
        quantity: line.quantity,
        lineTotal: price?.lineTotal ?? 0,
        notes: line.notes,
        addOns: line.addOns.map((entry) => ({
          id: entry.id,
          addOnId: entry.addOnId,
          name: entry.addOn.name,
          price: Number(entry.addOn.price),
          quantity: entry.quantity,
          isAvailable: entry.addOn.isAvailable,
        })),
        isAvailable: !blockedLines.has(line.id),
      };
    });
  }
}
