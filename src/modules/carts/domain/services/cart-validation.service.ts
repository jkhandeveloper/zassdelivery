import { MenuItemStatus, RestaurantStatus } from '@prisma/client';

import { type ItemAvailabilityService } from '@/modules/menus/domain/services/item-availability.service';

import type { CartWithContents } from '../repositories/cart.repository';

export type CartIssueCode =
  | 'RESTAURANT_CLOSED'
  | 'RESTAURANT_UNAVAILABLE'
  | 'ITEM_UNAVAILABLE'
  | 'ITEM_REMOVED'
  | 'VARIANT_UNAVAILABLE'
  | 'ADDON_UNAVAILABLE'
  | 'INSUFFICIENT_STOCK'
  | 'PRICE_CHANGED'
  | 'BELOW_MINIMUM_ORDER'
  | 'NO_ADDRESS'
  | 'OUTSIDE_DELIVERY_AREA'
  | 'COUPON_INVALID'
  | 'EMPTY_CART';

export interface CartIssue {
  code: CartIssueCode;
  message: string;
  /** The offending line, when the problem is item-specific. */
  cartItemId?: string;
  /** True when the customer must act before checkout can proceed. */
  blocking: boolean;
}

/**
 * Checks a basket against the world as it is now.
 *
 * A cart is a snapshot of intent taken minutes or hours ago; by checkout the
 * kitchen may have closed, a dish sold out or a price moved. Every issue is
 * reported with a stable code and a `blocking` flag rather than throwing on the
 * first problem, so the client can show the customer everything that needs
 * fixing at once instead of one error per round-trip.
 */
export class CartValidationService {
  constructor(private readonly availability: ItemAvailabilityService) {}

  validate(cart: CartWithContents, now: Date = new Date()): CartIssue[] {
    const issues: CartIssue[] = [];

    if (cart.items.length === 0) {
      return [
        {
          code: 'EMPTY_CART',
          message: 'Your cart is empty.',
          blocking: true,
        },
      ];
    }

    if (cart.restaurant.status !== RestaurantStatus.ACTIVE) {
      issues.push({
        code: 'RESTAURANT_UNAVAILABLE',
        message: `${cart.restaurant.name} is not currently available.`,
        blocking: true,
      });
    } else if (!cart.restaurant.isAcceptingOrders) {
      issues.push({
        code: 'RESTAURANT_CLOSED',
        message: `${cart.restaurant.name} has paused new orders.`,
        blocking: true,
      });
    }

    for (const line of cart.items) {
      const item = line.menuItem;

      if (item.deletedAt !== null) {
        issues.push({
          code: 'ITEM_REMOVED',
          message: `${item.name} is no longer on the menu.`,
          cartItemId: line.id,
          blocking: true,
        });
        continue;
      }

      if (item.status !== MenuItemStatus.AVAILABLE) {
        issues.push({
          code: 'ITEM_UNAVAILABLE',
          message: `${item.name} is currently unavailable.`,
          cartItemId: line.id,
          blocking: true,
        });
        continue;
      }

      const state = this.availability.evaluate(item, now);

      if (!state.isAvailable) {
        issues.push({
          code: state.reason === 'outside_window' ? 'ITEM_UNAVAILABLE' : 'INSUFFICIENT_STOCK',
          message:
            state.reason === 'outside_window'
              ? `${item.name} is not served at this time of day.`
              : `${item.name} has sold out.`,
          cartItemId: line.id,
          blocking: true,
        });
        continue;
      }

      // Stock is checked against the quantity in the basket, not merely
      // "is there any left" — three in the cart with two remaining is still a
      // problem the customer has to resolve.
      if (item.trackInventory && item.stockQuantity < line.quantity) {
        issues.push({
          code: 'INSUFFICIENT_STOCK',
          message: `Only ${item.stockQuantity} of ${item.name} left; your cart has ${line.quantity}.`,
          cartItemId: line.id,
          blocking: true,
        });
      }

      if (line.variant) {
        if (!this.availability.isVariantAvailable(line.variant)) {
          issues.push({
            code: 'VARIANT_UNAVAILABLE',
            message: `${item.name} (${line.variant.name}) is unavailable.`,
            cartItemId: line.id,
            blocking: true,
          });
        } else if (line.variant.trackInventory && line.variant.stockQuantity < line.quantity) {
          issues.push({
            code: 'INSUFFICIENT_STOCK',
            message: `Only ${line.variant.stockQuantity} of ${item.name} (${line.variant.name}) left.`,
            cartItemId: line.id,
            blocking: true,
          });
        }
      }

      for (const entry of line.addOns) {
        if (!entry.addOn.isAvailable) {
          issues.push({
            code: 'ADDON_UNAVAILABLE',
            message: `${entry.addOn.name} is unavailable and will be removed from ${item.name}.`,
            cartItemId: line.id,
            // Non-blocking: an unavailable extra is dropped from the line
            // rather than stopping the whole order.
            blocking: false,
          });
        }
      }
    }

    return issues;
  }

  /** Issues that must be resolved before an order can be placed. */
  static blockingOnly(issues: CartIssue[]): CartIssue[] {
    return issues.filter((issue) => issue.blocking);
  }
}
