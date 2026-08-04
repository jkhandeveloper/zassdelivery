import { Injectable } from '@nestjs/common';
import type { CartItem, Prisma } from '@prisma/client';

import { PrismaService } from '@/infrastructure/prisma/prisma.service';

import {
  CartRepository,
  type AddItemInput,
  type CartWithContents,
} from '../../domain/repositories/cart.repository';

/** Everything pricing and validation need, loaded in one read. */
const CONTENTS = {
  restaurant: {
    select: {
      id: true,
      name: true,
      slug: true,
      logoUrl: true,
      status: true,
      isAcceptingOrders: true,
      minOrderAmount: true,
      avgPreparationMinutes: true,
      zoneId: true,
      latitude: true,
      longitude: true,
      deliveryRadiusMeters: true,
    },
  },
  address: true,
  coupon: true,
  items: {
    orderBy: { createdAt: 'asc' },
    include: {
      menuItem: true,
      variant: true,
      addOns: { include: { addOn: true } },
    },
  },
} satisfies Prisma.CartInclude;

function expiryFrom(ttlHours: number): Date {
  return new Date(Date.now() + ttlHours * 60 * 60 * 1000);
}

@Injectable()
export class PrismaCartRepository extends CartRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async findByUserId(userId: string): Promise<CartWithContents | null> {
    return this.prisma.cart.findUnique({ where: { userId }, include: CONTENTS });
  }

  async findById(cartId: string): Promise<CartWithContents | null> {
    return this.prisma.cart.findUnique({ where: { id: cartId }, include: CONTENTS });
  }

  async findOrCreate(
    userId: string,
    restaurantId: string,
    ttlHours: number,
  ): Promise<{ cart: CartWithContents; replacedRestaurant: string | null }> {
    const existing = await this.prisma.cart.findUnique({
      where: { userId },
      include: CONTENTS,
    });

    if (existing && existing.restaurantId === restaurantId) {
      return { cart: existing, replacedRestaurant: null };
    }

    if (existing) {
      // Switching restaurants replaces the basket wholesale. Delete-then-create
      // in one transaction so a failure cannot leave the customer with no cart
      // at all — the unique constraint on userId makes an in-place swap
      // impossible to express otherwise.
      const previous = existing.restaurant.name;

      const cart = await this.prisma.$transaction(async (tx) => {
        await tx.cart.delete({ where: { id: existing.id } });

        return tx.cart.create({
          data: { userId, restaurantId, expiresAt: expiryFrom(ttlHours) },
          include: CONTENTS,
        });
      });

      return { cart, replacedRestaurant: previous };
    }

    const cart = await this.prisma.cart.create({
      data: { userId, restaurantId, expiresAt: expiryFrom(ttlHours) },
      include: CONTENTS,
    });

    return { cart, replacedRestaurant: null };
  }

  async addItem(cartId: string, input: AddItemInput): Promise<CartWithContents> {
    await this.prisma.cartItem.create({
      data: {
        cartId,
        menuItemId: input.menuItemId,
        variantId: input.variantId ?? null,
        quantity: input.quantity,
        notes: input.notes ?? null,
        addOns: {
          create: input.addOns.map((addOn) => ({
            addOnId: addOn.addOnId,
            quantity: addOn.quantity,
          })),
        },
      },
    });

    // Touching the basket extends its life: an actively edited cart should not
    // be swept out from under the customer.
    return this.refresh(cartId);
  }

  async incrementItem(cartItemId: string, by: number): Promise<void> {
    await this.prisma.cartItem.update({
      where: { id: cartItemId },
      data: { quantity: { increment: by } },
    });
  }

  async findItem(cartItemId: string): Promise<(CartItem & { cartId: string }) | null> {
    return this.prisma.cartItem.findUnique({ where: { id: cartItemId } });
  }

  async updateItemQuantity(cartItemId: string, quantity: number): Promise<CartWithContents> {
    const item = await this.prisma.cartItem.update({
      where: { id: cartItemId },
      data: { quantity },
      select: { cartId: true },
    });

    return this.refresh(item.cartId);
  }

  async removeItem(cartItemId: string): Promise<CartWithContents> {
    const item = await this.prisma.cartItem.delete({
      where: { id: cartItemId },
      select: { cartId: true },
    });

    return this.refresh(item.cartId);
  }

  async clear(userId: string): Promise<void> {
    // Items and their add-ons cascade from the cart row.
    await this.prisma.cart.deleteMany({ where: { userId } });
  }

  async setCoupon(cartId: string, couponId: string | null, code: string | null): Promise<void> {
    await this.prisma.cart.update({
      where: { id: cartId },
      data: { couponId, couponCode: code },
    });
  }

  async setAddress(cartId: string, addressId: string | null): Promise<void> {
    await this.prisma.cart.update({ where: { id: cartId }, data: { addressId } });
  }

  async setTip(cartId: string, tipAmount: number): Promise<void> {
    await this.prisma.cart.update({ where: { id: cartId }, data: { tipAmount } });
  }

  async touchExpiry(cartId: string, ttlHours: number): Promise<void> {
    await this.prisma.cart.update({
      where: { id: cartId },
      data: { expiresAt: expiryFrom(ttlHours) },
    });
  }

  async deleteExpired(before: Date): Promise<number> {
    const result = await this.prisma.cart.deleteMany({ where: { expiresAt: { lt: before } } });
    return result.count;
  }

  /** Re-reads the basket and pushes its expiry out, since it was just used. */
  private async refresh(cartId: string): Promise<CartWithContents> {
    const [cart] = await this.prisma.$transaction([
      this.prisma.cart.findUniqueOrThrow({ where: { id: cartId }, include: CONTENTS }),
      this.prisma.cart.update({
        where: { id: cartId },
        data: { expiresAt: expiryFrom(72) },
      }),
    ]);

    return cart;
  }
}
