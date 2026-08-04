import { Inject, Injectable, type LoggerService } from '@nestjs/common';
import { OrderStatus, PaymentMethod, PaymentStatus, UserRole } from '@prisma/client';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import type { ConfigType } from '@nestjs/config';

import {
  BusinessRuleViolationException,
  ForbiddenOperationException,
  ResourceNotFoundException,
} from '@/common/exceptions/domain.exception';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import { paymentsConfig } from '@/config';
import { OrderRepository } from '@/modules/orders/domain/repositories/order.repository';

import {
  PaymentRepository,
  type PaymentWithContext,
} from '../../domain/repositories/payment.repository';
import { PaymentGatewayRegistry } from '../../domain/services/payment-gateway';
import { PaymentStateMachine } from '../../domain/services/payment-state';
import {
  toPaymentDto,
  type CheckoutDto,
  type GatewayAvailabilityDto,
} from '../dto/payment-response.dto';
import type { StartCheckoutDto } from '../dto/payment.dto';

/**
 * Resolves a payment and decides whether the caller may see it.
 *
 * Shared by every payment route, so no handler can forget the check and let one
 * customer read another's payment history.
 */
@Injectable()
export class PaymentAccessService {
  constructor(private readonly payments: PaymentRepository) {}

  async load(paymentId: string): Promise<PaymentWithContext> {
    const payment = await this.payments.findById(paymentId);

    if (!payment) {
      throw new ResourceNotFoundException('Payment', paymentId);
    }

    return payment;
  }

  /** The payment, provided it is the caller's own or the caller is staff. */
  async loadFor(paymentId: string, actor: AuthenticatedUser): Promise<PaymentWithContext> {
    const payment = await this.load(paymentId);

    if (PaymentAccessService.isStaff(actor) || payment.userId === actor.id) {
      return payment;
    }

    // 404 rather than 403: confirming a payment id exists is itself a
    // disclosure about somebody else's order.
    throw new ResourceNotFoundException('Payment', paymentId);
  }

  static isStaff(actor: AuthenticatedUser): boolean {
    return actor.role === UserRole.ADMIN || actor.role === UserRole.SUPER_ADMIN;
  }
}

@Injectable()
export class ListGatewaysUseCase {
  constructor(private readonly gateways: PaymentGatewayRegistry) {}

  /**
   * What this deployment can actually take money with.
   *
   * The checkout screen reads this rather than hard-coding a list, so a gateway
   * whose credentials are missing is greyed out up front instead of failing at
   * the moment the customer commits to paying.
   */
  execute(): GatewayAvailabilityDto[] {
    const online = this.gateways.all().map((gateway) => ({
      name: gateway.name,
      method: gateway.method,
      available: gateway.isConfigured(),
    }));

    return [
      { name: 'cash', method: PaymentMethod.CASH_ON_DELIVERY, available: true },
      { name: 'wallet', method: PaymentMethod.WALLET, available: true },
      ...online,
    ];
  }
}

@Injectable()
export class StartCheckoutUseCase {
  private readonly context = StartCheckoutUseCase.name;

  constructor(
    private readonly payments: PaymentRepository,
    private readonly orders: OrderRepository,
    private readonly gateways: PaymentGatewayRegistry,
    @Inject(paymentsConfig.KEY)
    private readonly config: ConfigType<typeof paymentsConfig>,
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: LoggerService,
  ) {}

  /**
   * Opens a payment attempt for an order and returns whatever the customer
   * needs to do next.
   *
   * One entry point for every method, because the client should not have to
   * know which of them redirect: it posts a method and gets back an action.
   */
  async execute(
    orderId: string,
    dto: StartCheckoutDto,
    actor: AuthenticatedUser,
  ): Promise<CheckoutDto> {
    const order = await this.orders.findById(orderId);

    if (!order || order.customerId !== actor.id) {
      throw new ResourceNotFoundException('Order', orderId);
    }

    if (order.paymentStatus === PaymentStatus.PAID) {
      throw new BusinessRuleViolationException('This order has already been paid for.');
    }

    // Only an order that is waiting for money can start a payment. A delivered
    // cash order is settled by the rider, not by a checkout page.
    const payable: OrderStatus[] = [OrderStatus.PENDING_PAYMENT, OrderStatus.PLACED];

    if (!payable.includes(order.status)) {
      throw new BusinessRuleViolationException(
        `An order that is ${order.status.toLowerCase().replace(/_/g, ' ')} cannot start a new payment.`,
      );
    }

    const amount = Number(order.totalAmount);

    if (dto.method === PaymentMethod.CASH_ON_DELIVERY) {
      return this.cashOnDelivery(order.id, actor.id, amount, order.orderNumber);
    }

    if (dto.method === PaymentMethod.WALLET) {
      throw new BusinessRuleViolationException(
        'Wallet payments are taken at checkout. Place the order with paymentMethod=WALLET instead.',
      );
    }

    return this.online(order, dto.method, actor, amount);
  }

  private async cashOnDelivery(
    orderId: string,
    userId: string,
    amount: number,
    orderNumber: string,
  ): Promise<CheckoutDto> {
    const existing = await this.payments.findOpenForOrder(orderId);

    const payment =
      existing !== null && existing.method === PaymentMethod.CASH_ON_DELIVERY
        ? existing
        : await this.payments.createAttempt({
            orderId,
            userId,
            method: PaymentMethod.CASH_ON_DELIVERY,
            amount,
            gatewayName: null,
            // Cash has no checkout window; it is settled at the door.
            expiresAt: null,
          });

    return {
      payment: toPaymentDto(payment),
      action: 'ON_DELIVERY',
      message: `Pay the rider Rs. ${amount} when order ${orderNumber} arrives.`,
    };
  }

  private async online(
    order: { id: string; orderNumber: string },
    method: PaymentMethod,
    actor: AuthenticatedUser,
    amount: number,
  ): Promise<CheckoutDto> {
    const gateway = this.gateways.forMethod(method);

    if (gateway === null || !gateway.isConfigured()) {
      throw new BusinessRuleViolationException(
        `${method} is not available on this deployment. Choose cash on delivery, or another method.`,
      );
    }

    // A previous attempt that is still open is reused rather than stacked on:
    // two live attempts against one order is how a customer ends up paying
    // twice and support ends up refunding one of them by hand.
    const open = await this.payments.findOpenForOrder(order.id);

    if (open !== null && open.method !== method) {
      await this.payments.fail({
        paymentId: open.id,
        reason: `Superseded — the customer chose ${method} instead.`,
        gatewayResponse: null,
        status: PaymentStatus.CANCELLED,
        failOrder: false,
      });
    }

    const expiresAt = new Date(Date.now() + this.config.checkoutTtlMinutes * 60_000);

    const reusable =
      open !== null &&
      open.method === method &&
      open.expiresAt !== null &&
      open.expiresAt > new Date();

    const payment = reusable
      ? open
      : await this.payments.createAttempt({
          orderId: order.id,
          userId: actor.id,
          method,
          amount,
          gatewayName: gateway.name,
          expiresAt,
        });

    const instruction = gateway.createCheckout({
      reference: payment.reference ?? payment.id,
      amount,
      currency: payment.currency,
      orderNumber: order.orderNumber,
      description: `ZassDelivery order ${order.orderNumber}`,
      customerPhone: payment.user.phone,
      customerEmail: payment.user.email,
      expiresAt: payment.expiresAt ?? expiresAt,
    });

    this.logger.log?.(
      `Checkout opened for ${order.orderNumber} via ${gateway.name} (${payment.reference})`,
      this.context,
    );

    return {
      payment: toPaymentDto(payment),
      action: 'REDIRECT',
      message: `Complete the payment of Rs. ${amount} with ${gateway.name}.`,
      checkout: {
        url: instruction.url,
        method: instruction.method,
        fields: instruction.fields,
      },
    };
  }
}

@Injectable()
export class CancelCheckoutUseCase {
  constructor(
    private readonly payments: PaymentRepository,
    private readonly access: PaymentAccessService,
  ) {}

  /**
   * Abandons an attempt the customer walked away from.
   *
   * The order survives: a customer who backs out of JazzCash to pay cash
   * instead has not cancelled their dinner.
   */
  async execute(paymentId: string, actor: AuthenticatedUser) {
    const payment = await this.access.loadFor(paymentId, actor);

    if (PaymentStateMachine.isSettled(payment.status)) {
      throw new BusinessRuleViolationException(
        'This payment has already gone through. Ask support for a refund instead.',
      );
    }

    if (!PaymentAccessService.isStaff(actor) && payment.userId !== actor.id) {
      throw new ForbiddenOperationException('This is not your payment.');
    }

    const cancelled = await this.payments.fail({
      paymentId,
      reason: 'Cancelled by the customer',
      gatewayResponse: null,
      status: PaymentStatus.CANCELLED,
      failOrder: false,
    });

    return toPaymentDto(cancelled);
  }
}
