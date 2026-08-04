import { Injectable } from '@nestjs/common';
import { MenuItemStatus } from '@prisma/client';

import {
  BusinessRuleViolationException,
  ResourceNotFoundException,
} from '@/common/exceptions/domain.exception';
import { MenuItemRepository } from '@/modules/menus/domain/repositories/menu-item.repository';
import { AddressRepository } from '@/modules/users/domain/repositories/address.repository';

import {
  CartCouponRepository,
  CartRepository,
  type CartWithContents,
} from '../../domain/repositories/cart.repository';
import type { CartDto, EmptyCartDto } from '../dto/cart-response.dto';
import type {
  AddCartItemDto,
  ApplyCouponDto,
  SetCartAddressDto,
  SetTipDto,
  UpdateCartItemDto,
} from '../dto/cart.dto';
import { CartAssemblerService } from './cart-assembler.service';

/** How long an untouched basket survives before the sweeper removes it. */
const CART_TTL_HOURS = 72;
const MAX_LINES_PER_CART = 50;

@Injectable()
export class GetCartUseCase {
  constructor(
    private readonly carts: CartRepository,
    private readonly assembler: CartAssemblerService,
  ) {}

  async execute(userId: string): Promise<CartDto | EmptyCartDto> {
    const cart = await this.carts.findByUserId(userId);

    if (!cart) {
      // An absent basket is a normal state, not an error — returning 404 would
      // make every client special-case its first load.
      return { id: null, isEmpty: true, message: 'Your cart is empty.' };
    }

    return this.assembler.assemble(cart);
  }
}

@Injectable()
export class AddCartItemUseCase {
  constructor(
    private readonly carts: CartRepository,
    private readonly items: MenuItemRepository,
    private readonly assembler: CartAssemblerService,
  ) {}

  async execute(userId: string, dto: AddCartItemDto): Promise<CartDto> {
    const item = await this.items.findById(dto.menuItemId);

    if (!item) {
      throw new ResourceNotFoundException('Menu item', dto.menuItemId);
    }

    if (item.status !== MenuItemStatus.AVAILABLE) {
      throw new BusinessRuleViolationException(`${item.name} is currently unavailable.`);
    }

    const quantity = dto.quantity ?? 1;
    const selections = dto.addOns ?? [];

    const variantId = this.resolveVariant(item, dto.variantId);
    this.assertAddOns(item, selections);

    if (item.trackInventory && item.stockQuantity < quantity) {
      throw new BusinessRuleViolationException(`Only ${item.stockQuantity} of ${item.name} left.`);
    }

    // Adding from another restaurant replaces the basket rather than failing:
    // the alternative is a dead end where the customer must find and clear the
    // old cart before they can order what they are looking at.
    const { cart } = await this.carts.findOrCreate(userId, item.restaurantId, CART_TTL_HOURS);

    if (cart.items.length >= MAX_LINES_PER_CART) {
      throw new BusinessRuleViolationException(
        `A cart may hold at most ${MAX_LINES_PER_CART} different items.`,
      );
    }

    // Identical selections merge into the existing line instead of stacking
    // duplicates the customer would then have to remove one by one.
    const signature = this.signatureOf(dto.menuItemId, variantId, selections, dto.notes);
    const existing = cart.items.find(
      (line) =>
        this.signatureOf(
          line.menuItemId,
          line.variantId,
          line.addOns.map((entry) => ({ addOnId: entry.addOnId, quantity: entry.quantity })),
          line.notes,
        ) === signature,
    );

    if (existing) {
      await this.carts.incrementItem(existing.id, quantity);
      const refreshed = await this.carts.findByUserId(userId);
      return this.assembler.assemble(refreshed ?? cart);
    }

    const updated = await this.carts.addItem(cart.id, {
      menuItemId: dto.menuItemId,
      variantId,
      quantity,
      notes: dto.notes ?? null,
      addOns: selections.map((selection) => ({
        addOnId: selection.addOnId,
        quantity: selection.quantity ?? 1,
      })),
    });

    return this.assembler.assemble(updated);
  }

  /** A dish with variants cannot be ordered without choosing one. */
  private resolveVariant(
    item: Awaited<ReturnType<MenuItemRepository['findById']>>,
    requested: string | undefined,
  ): string | null {
    if (!item) {
      return null;
    }

    if (item.variants.length === 0) {
      if (requested) {
        throw new BusinessRuleViolationException(`${item.name} has no variants to choose from.`);
      }
      return null;
    }

    if (!requested) {
      const fallback = item.variants.find((variant) => variant.isDefault);

      if (!fallback) {
        throw new BusinessRuleViolationException(`Choose a variant for ${item.name}.`);
      }

      return fallback.id;
    }

    const variant = item.variants.find((candidate) => candidate.id === requested);

    if (!variant) {
      throw new BusinessRuleViolationException(`That variant does not belong to ${item.name}.`);
    }

    if (!variant.isAvailable) {
      throw new BusinessRuleViolationException(`${item.name} (${variant.name}) is unavailable.`);
    }

    return variant.id;
  }

  /**
   * Enforces each option group's selection rules at add time.
   *
   * The kitchen relies on these — "choose a sauce" with nothing chosen produces
   * an order nobody can fulfil — so they are checked here rather than left to
   * the client.
   */
  private assertAddOns(
    item: NonNullable<Awaited<ReturnType<MenuItemRepository['findById']>>>,
    selections: Array<{ addOnId: string; quantity?: number }>,
  ): void {
    const known = new Map(
      item.addOnGroups.flatMap((group) =>
        group.addOns.map((addOn) => [addOn.id, { group, addOn }] as const),
      ),
    );

    for (const selection of selections) {
      const entry = known.get(selection.addOnId);

      if (!entry) {
        throw new BusinessRuleViolationException(`That option is not available for ${item.name}.`);
      }

      if (!entry.addOn.isAvailable) {
        throw new BusinessRuleViolationException(`${entry.addOn.name} is unavailable.`);
      }
    }

    for (const group of item.addOnGroups) {
      const chosen = selections.filter((selection) =>
        group.addOns.some((addOn) => addOn.id === selection.addOnId),
      ).length;

      if (chosen < group.minSelect) {
        throw new BusinessRuleViolationException(
          `${group.name}: choose at least ${group.minSelect} option(s).`,
        );
      }

      if (chosen > group.maxSelect) {
        throw new BusinessRuleViolationException(
          `${group.name}: choose at most ${group.maxSelect} option(s).`,
        );
      }
    }
  }

  /** Identity of a line: same dish, variant, extras and note. */
  private signatureOf(
    menuItemId: string,
    variantId: string | null,
    addOns: Array<{ addOnId: string; quantity?: number }>,
    notes: string | null | undefined,
  ): string {
    const extras = addOns
      .map((entry) => `${entry.addOnId}x${entry.quantity ?? 1}`)
      .sort()
      .join(',');

    return `${menuItemId}|${variantId ?? '-'}|${extras}|${notes ?? ''}`;
  }
}

@Injectable()
export class UpdateCartItemUseCase {
  constructor(
    private readonly carts: CartRepository,
    private readonly assembler: CartAssemblerService,
  ) {}

  async execute(
    userId: string,
    cartItemId: string,
    dto: UpdateCartItemDto,
  ): Promise<CartDto | EmptyCartDto> {
    await this.requireOwnedLine(userId, cartItemId);

    // Zero is a removal rather than an error: a quantity stepper reaching zero
    // is exactly how customers expect to delete a line.
    const updated =
      dto.quantity === 0
        ? await this.carts.removeItem(cartItemId)
        : await this.carts.updateItemQuantity(cartItemId, dto.quantity);

    if (updated.items.length === 0) {
      await this.carts.clear(userId);
      return { id: null, isEmpty: true, message: 'Your cart is empty.' };
    }

    return this.assembler.assemble(updated);
  }

  private async requireOwnedLine(userId: string, cartItemId: string): Promise<void> {
    const cart = await this.carts.findByUserId(userId);

    // 404 rather than 403 for a line in someone else's basket: confirming the
    // id exists would itself be a disclosure.
    if (!cart || !cart.items.some((line) => line.id === cartItemId)) {
      throw new ResourceNotFoundException('Cart item', cartItemId);
    }
  }
}

@Injectable()
export class RemoveCartItemUseCase {
  constructor(
    private readonly carts: CartRepository,
    private readonly assembler: CartAssemblerService,
  ) {}

  async execute(userId: string, cartItemId: string): Promise<CartDto | EmptyCartDto> {
    const cart = await this.carts.findByUserId(userId);

    if (!cart || !cart.items.some((line) => line.id === cartItemId)) {
      throw new ResourceNotFoundException('Cart item', cartItemId);
    }

    const updated = await this.carts.removeItem(cartItemId);

    // An emptied basket is discarded rather than left behind pinned to a
    // restaurant, which would otherwise force a "clear cart" prompt the next
    // time the customer orders elsewhere.
    if (updated.items.length === 0) {
      await this.carts.clear(userId);
      return { id: null, isEmpty: true, message: 'Your cart is empty.' };
    }

    return this.assembler.assemble(updated);
  }
}

@Injectable()
export class ClearCartUseCase {
  constructor(private readonly carts: CartRepository) {}

  async execute(userId: string): Promise<{ message: string }> {
    await this.carts.clear(userId);
    return { message: 'Cart cleared.' };
  }
}

@Injectable()
export class ApplyCouponUseCase {
  constructor(
    private readonly carts: CartRepository,
    private readonly coupons: CartCouponRepository,
    private readonly assembler: CartAssemblerService,
  ) {}

  async execute(userId: string, dto: ApplyCouponDto): Promise<CartDto> {
    const cart = await this.requireCart(userId);
    const coupon = await this.coupons.findActiveByCode(dto.code);

    // One message for "no such code" and "expired": enumerating which codes
    // exist is exactly how coupon-guessing scripts operate.
    const invalid = new BusinessRuleViolationException(
      'This coupon code is not valid or has expired.',
    );

    if (!coupon) {
      throw invalid;
    }

    const now = new Date();

    if (!coupon.isActive || coupon.startsAt > now || coupon.expiresAt < now) {
      throw invalid;
    }

    if (coupon.usageLimit !== null && coupon.usageCount >= coupon.usageLimit) {
      throw new BusinessRuleViolationException('This coupon has been fully redeemed.');
    }

    if (coupon.restaurantId !== null && coupon.restaurantId !== cart.restaurantId) {
      throw new BusinessRuleViolationException('This coupon cannot be used at this restaurant.');
    }

    if (coupon.zoneId !== null && cart.address !== null && coupon.zoneId !== cart.address.zoneId) {
      throw new BusinessRuleViolationException(
        'This coupon is not available in your delivery area.',
      );
    }

    if (coupon.perUserLimit !== null) {
      const used = await this.coupons.countRedemptionsByUser(coupon.id, userId);

      if (used >= coupon.perUserLimit) {
        throw new BusinessRuleViolationException(
          'You have already used this coupon the maximum number of times.',
        );
      }
    }

    if (coupon.firstOrderOnly && (await this.coupons.hasPlacedOrder(userId))) {
      throw new BusinessRuleViolationException('This coupon is only valid on your first order.');
    }

    await this.carts.setCoupon(cart.id, coupon.id, coupon.code);

    const refreshed = await this.carts.findByUserId(userId);

    return this.assembler.assemble(refreshed ?? cart);
  }

  private async requireCart(userId: string): Promise<CartWithContents> {
    const cart = await this.carts.findByUserId(userId);

    if (!cart || cart.items.length === 0) {
      throw new BusinessRuleViolationException('Add something to your cart first.');
    }

    return cart;
  }
}

@Injectable()
export class RemoveCouponUseCase {
  constructor(
    private readonly carts: CartRepository,
    private readonly assembler: CartAssemblerService,
  ) {}

  async execute(userId: string): Promise<CartDto> {
    const cart = await this.carts.findByUserId(userId);

    if (!cart) {
      throw new ResourceNotFoundException('Cart');
    }

    await this.carts.setCoupon(cart.id, null, null);

    const refreshed = await this.carts.findByUserId(userId);

    return this.assembler.assemble(refreshed ?? cart);
  }
}

@Injectable()
export class SetCartAddressUseCase {
  constructor(
    private readonly carts: CartRepository,
    private readonly addresses: AddressRepository,
    private readonly assembler: CartAssemblerService,
  ) {}

  async execute(userId: string, dto: SetCartAddressDto): Promise<CartDto> {
    const cart = await this.carts.findByUserId(userId);

    if (!cart) {
      throw new ResourceNotFoundException('Cart');
    }

    const address = await this.addresses.findById(dto.addressId);

    // Ownership is checked here, not merely existence: delivering to an
    // arbitrary address id would leak where other customers live.
    if (!address || address.userId !== userId || address.deletedAt !== null) {
      throw new ResourceNotFoundException('Address', dto.addressId);
    }

    await this.carts.setAddress(cart.id, address.id);

    const refreshed = await this.carts.findByUserId(userId);

    return this.assembler.assemble(refreshed ?? cart);
  }
}

@Injectable()
export class SetTipUseCase {
  constructor(
    private readonly carts: CartRepository,
    private readonly assembler: CartAssemblerService,
  ) {}

  async execute(userId: string, dto: SetTipDto): Promise<CartDto> {
    const cart = await this.carts.findByUserId(userId);

    if (!cart) {
      throw new ResourceNotFoundException('Cart');
    }

    await this.carts.setTip(cart.id, dto.tipAmount);

    const refreshed = await this.carts.findByUserId(userId);

    return this.assembler.assemble(refreshed ?? cart);
  }
}

@Injectable()
export class ValidateCartUseCase {
  constructor(
    private readonly carts: CartRepository,
    private readonly assembler: CartAssemblerService,
  ) {}

  /**
   * The pre-checkout check. Returns the same shape as `GET /cart` so a client
   * can re-render the basket straight from the response instead of issuing a
   * second request to find out what changed.
   */
  async execute(userId: string): Promise<CartDto> {
    const cart = await this.carts.findByUserId(userId);

    if (!cart) {
      throw new BusinessRuleViolationException('Your cart is empty.');
    }

    // Assembled rather than thrown even when the restaurant has gone away: the
    // client needs the issue list to tell the customer what happened, and a
    // bare error would leave them staring at an empty screen.
    return this.assembler.assemble(cart);
  }
}
