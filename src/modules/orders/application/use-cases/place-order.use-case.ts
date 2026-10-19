import { Inject, Injectable, type LoggerService } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { OrderStatus, OrderType, PaymentMethod } from '@prisma/client';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';

import { toPaymentQrCodes } from '@/common/dto/payment-qr-code.dto';
import { BusinessRuleViolationException } from '@/common/exceptions/domain.exception';
import { CartAssemblerService } from '@/modules/carts/application/use-cases/cart-assembler.service';
import { CartRepository } from '@/modules/carts/domain/repositories/cart.repository';
import { CartValidationService } from '@/modules/carts/domain/services/cart-validation.service';
import { RealtimeService } from '@/modules/realtime/application/realtime.service';

import { OrderEvents, type OrderStatusEventPayload } from '../../domain/events/order.events';
import { OrderRepository } from '../../domain/repositories/order.repository';
import { OrderStateMachine } from '../../domain/services/order-state-machine';
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
    private readonly events: EventEmitter2,
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

    const pickup = cart.fulfilment === OrderType.PICKUP;
    const address = pickup ? null : cart.address;

    if (!pickup && address === null) {
      throw new BusinessRuleViolationException('Choose a delivery address first.');
    }

    const method = dto.paymentMethod ?? PaymentMethod.CASH_ON_DELIVERY;

    // Scan-to-pay needs something to scan. Refused here rather than discovered
    // on the order screen, where the customer would be holding an order with no
    // way to pay for it.
    if (
      method === PaymentMethod.QR_TRANSFER &&
      toPaymentQrCodes(cart.restaurant.paymentQrCodes).length === 0
    ) {
      throw new BusinessRuleViolationException(
        `${cart.restaurant.name} does not take scan-to-pay yet. Choose cash on delivery instead.`,
      );
    }

    const totals = priced.totals;

    const preparationMinutes = cart.restaurant.avgPreparationMinutes;
    const etaMinutes = priced.delivery.etaMinutes ?? preparationMinutes + (pickup ? 0 : 30);

    const order = await this.orders.place(
      {
        customerId: userId,
        restaurantId: cart.restaurantId,
        zoneId: address?.zoneId ?? cart.restaurant.zoneId,
        type: pickup ? OrderType.PICKUP : OrderType.DELIVERY,
        addressId: address?.id ?? null,
        // Snapshotted: the customer may edit or delete this address later,
        // but where the order actually went must never change. A pickup order
        // goes nowhere, so it has none.
        delivery:
          address === null
            ? null
            : {
                line1: address.line1,
                landmark: address.landmark,
                latitude: address.latitude,
                longitude: address.longitude,
                recipientName: address.recipientName ?? '',
                recipientPhone: address.recipientPhone ?? '',
                notes: address.deliveryNotes,
              },
        // Already confirmed free by the assembler, which blocks checkout when
        // the chosen rider has gone.
        preferredDriverId: pickup ? null : cart.preferredDriverId,
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

      // Emitted only for an order that is actually live, on the same condition
      // as the socket push above: a gateway order still waiting on the money is
      // not something to notify anybody about yet.
      const payload: OrderStatusEventPayload = {
        orderId: order.id,
        orderNumber: order.orderNumber,
        status: order.status,
        statusText: OrderStateMachine.describe(order.status, order.type),
        previousStatus: null,
        actor: null,
        orderType: order.type,
        customerId: order.customerId,
        restaurantId: order.restaurantId,
        restaurantName: order.restaurant.name,
        restaurantOwnerId: order.restaurant.ownerId,
        driverUserId: null,
        totalAmount: Number(order.totalAmount),
        at: new Date().toISOString(),
      };

      this.events.emit(OrderEvents.placed, payload);
    }

    return toOrderDto(order, { includeTransactions: true });
  }
}
