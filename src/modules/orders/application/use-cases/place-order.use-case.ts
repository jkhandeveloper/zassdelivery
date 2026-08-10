import { Inject, Injectable, type LoggerService } from '@nestjs/common';
import { OrderStatus, PaymentMethod } from '@prisma/client';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';

import { BusinessRuleViolationException } from '@/common/exceptions/domain.exception';
import { CartAssemblerService } from '@/modules/carts/application/use-cases/cart-assembler.service';
import { CartRepository } from '@/modules/carts/domain/repositories/cart.repository';
import { CartValidationService } from '@/modules/carts/domain/services/cart-validation.service';
import { RealtimeService } from '@/modules/realtime/application/realtime.service';

import { OrderRepository } from '../../domain/repositories/order.repository';
import { toOrderDto, type OrderDto } from '../dto/order-response.dto';
import type { PlaceOrderDto } from '../dto/order.dto';

@Injectable()
export class PlaceOrderUseCase {
  private readonly context = PlaceOrderUseCase.name;

  constructor(
    private readonly carts: CartRepository,
    private readonly assembler: CartAssemblerService,
    private readonly orders: OrderRepository,
    private readonly realtime: RealtimeService,
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: LoggerService,
  ) {}

  /**
   * Turns the customer's cart into an order.
   *
   * The basket is re-validated and re-priced here rather than trusting whatever
   * the client last displayed: minutes may have passed since the cart screen
   * rendered, and a client-supplied total is an obvious way to pay less than
   * the food costs.
   */
  async execute(userId: string, dto: PlaceOrderDto): Promise<OrderDto> {
    const cart = await this.carts.findByUserId(userId);

    if (!cart || cart.items.length === 0) {
      throw new BusinessRuleViolationException('Your cart is empty.');
    }

    const priced = await this.assembler.assemble(cart);
    const blocking = CartValidationService.blockingOnly(
      priced.issues.map((issue) => ({
        code: issue.code as never,
        message: issue.message,
        cartItemId: issue.cartItemId,
        blocking: issue.blocking,
      })),
    );

    if (blocking.length > 0) {
      throw new BusinessRuleViolationException(
        `This order cannot be placed: ${blocking.map((issue) => issue.message).join(' ')}`,
      );
    }

    if (cart.address === null) {
      throw new BusinessRuleViolationException('Choose a delivery address first.');
    }

    const method = dto.paymentMethod ?? PaymentMethod.CASH_ON_DELIVERY;
    const totals = priced.totals;

    const preparationMinutes = cart.restaurant.avgPreparationMinutes;
    const etaMinutes = priced.delivery.etaMinutes ?? preparationMinutes + 30;

    const order = await this.orders.place(
      {
        customerId: userId,
        restaurantId: cart.restaurantId,
        zoneId: cart.address.zoneId ?? cart.restaurant.zoneId,
        addressId: cart.address.id,
        delivery: {
          // Snapshotted: the customer may edit or delete this address later,
          // but where the order actually went must never change.
          line1: cart.address.line1,
          landmark: cart.address.landmark,
          latitude: cart.address.latitude,
          longitude: cart.address.longitude,
          recipientName: cart.address.recipientName ?? '',
          recipientPhone: cart.address.recipientPhone ?? '',
          notes: cart.address.deliveryNotes,
        },
        totals: {
          subtotal: totals.subtotal,
          discountAmount: totals.discountAmount,
          deliveryFee: totals.deliveryFee,
          serviceFee: totals.serviceFee,
          taxAmount: totals.taxAmount,
          tipAmount: totals.tipAmount,
          totalAmount: totals.totalAmount,
        },
        couponId: cart.couponId,
        couponCode: cart.couponCode,
        paymentMethod: method,
        distanceKm: priced.delivery.distanceKm,
        preparationMinutes,
        estimatedDeliveryAt: new Date(Date.now() + etaMinutes * 60000),
        customerNote: dto.customerNote ?? cart.notes,
        lines: cart.items.map((line) => {
          const dishPrice =
            line.menuItem.discountedPrice === null
              ? Number(line.menuItem.basePrice)
              : Number(line.menuItem.discountedPrice);
          const unitPrice = line.variant === null ? dishPrice : Number(line.variant.price);

          // Unavailable extras were excluded from the price, so they must be
          // excluded from the order too — the customer is not paying for them
          // and will not receive them.
          const addOns = line.addOns.filter((entry) => entry.addOn.isAvailable);
          const addOnsTotal = addOns.reduce(
            (sum, entry) => sum + Number(entry.addOn.price) * entry.quantity,
            0,
          );

          return {
            menuItemId: line.menuItemId,
            variantId: line.variantId,
            nameSnapshot: line.menuItem.name,
            variantNameSnapshot: line.variant?.name ?? null,
            unitPrice,
            quantity: line.quantity,
            lineTotal: Math.round((unitPrice + addOnsTotal) * line.quantity * 100) / 100,
            notes: line.notes,
            tracksInventory: line.menuItem.trackInventory,
            addOns: addOns.map((entry) => ({
              addOnId: entry.addOnId,
              nameSnapshot: entry.addOn.name,
              price: Number(entry.addOn.price),
              quantity: entry.quantity,
            })),
          };
        }),
      },
      cart.id,
    );

    this.logger.log?.(
      `Order ${order.orderNumber} placed by ${userId} at ${cart.restaurant.name} for ${totals.totalAmount} PKR`,
      this.context,
    );

    // The kitchen's board updates without a refresh. A gateway order is held in
    // PENDING_PAYMENT and is deliberately not announced yet — the restaurant
    // hears about it when the money lands, not when the customer starts paying.
    if (order.status !== OrderStatus.PENDING_PAYMENT) {
      this.realtime.restaurantOrderPlaced(order.restaurantId, {
        orderId: order.id,
        orderNumber: order.orderNumber,
        status: order.status,
        totalAmount: Number(order.totalAmount),
        itemCount: order.items.length,
        customerName: order.customer.fullName,
        placedAt: order.placedAt?.toISOString() ?? null,
      });
    }

    return toOrderDto(order, { includeTransactions: true });
  }
}
