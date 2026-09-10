import { Injectable } from '@nestjs/common';
import { ActorType, OrderStatus, PaymentMethod } from '@prisma/client';

import { PAYMENT_QR_PROVIDER_NAMES, toPaymentQrCodes } from '@/common/dto/payment-qr-code.dto';
import {
  BusinessRuleViolationException,
  ForbiddenOperationException,
} from '@/common/exceptions/domain.exception';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import { OrderAccessService } from '@/modules/orders/application/use-cases/order-lifecycle.use-cases';

import {
  PaymentRepository,
  type SettleManualTransferInput,
} from '../../domain/repositories/payment.repository';
import { PaymentStateMachine } from '../../domain/services/payment-state';
import { toPaymentDto, type OrderPaymentQrDto, type PaymentDto } from '../dto/payment-response.dto';
import type { MarkPaymentReceivedDto } from '../dto/payment.dto';

/** Methods whose money reaches a person rather than a gateway, so a person confirms it. */
const HAND_CONFIRMED_METHODS: PaymentMethod[] = [
  PaymentMethod.QR_TRANSFER,
  PaymentMethod.CASH_ON_DELIVERY,
];

/** Orders that will never be paid for, because they will never be delivered. */
const DEAD_STATUSES: OrderStatus[] = [
  OrderStatus.CANCELLED,
  OrderStatus.REJECTED,
  OrderStatus.FAILED,
];

@Injectable()
export class GetOrderPaymentQrUseCase {
  constructor(private readonly access: OrderAccessService) {}

  /**
   * The codes a customer can scan to pay for this order.
   *
   * The restaurant's, and the rider's once one has the order — someone paying
   * at the door should be able to pay the person standing there. Customer and
   * staff only: the kitchen and the rider already know their own codes.
   */
  async execute(orderId: string, actor: AuthenticatedUser): Promise<OrderPaymentQrDto> {
    const { order, as } = await this.access.loadFor(orderId, actor);

    if (as !== ActorType.CUSTOMER && as !== ActorType.ADMIN) {
      throw new ForbiddenOperationException(
        'Only the customer can view the payment codes for this order.',
      );
    }

    return {
      orderId: order.id,
      orderNumber: order.orderNumber,
      amount: Number(order.totalAmount),
      currency: order.currency,
      paymentMethod: order.paymentMethod,
      paymentStatus: order.paymentStatus,
      restaurant: {
        name: order.restaurant.name,
        codes: toPaymentQrCodes(order.restaurant.paymentQrCodes),
      },
      rider:
        order.driver === null
          ? null
          : {
              name: order.driver.user.fullName,
              codes: toPaymentQrCodes(order.driver.paymentQrCodes),
            },
    };
  }
}

@Injectable()
export class MarkPaymentReceivedUseCase {
  constructor(
    private readonly access: OrderAccessService,
    private readonly payments: PaymentRepository,
  ) {}

  /**
   * Records that a scanned-QR transfer landed in the payee's account.
   *
   * There is no gateway behind a QR, so the only party who can say the money
   * arrived is the one it arrived with: the restaurant, or the rider carrying
   * the order. Never the customer — "I paid" is exactly the claim this step
   * exists to check.
   */
  async execute(
    orderId: string,
    dto: MarkPaymentReceivedDto,
    actor: AuthenticatedUser,
  ): Promise<PaymentDto> {
    const { order, as } = await this.access.loadFor(orderId, actor);

    if (as === ActorType.CUSTOMER) {
      throw new ForbiddenOperationException(
        'The restaurant or your rider confirms a transfer once it reaches them.',
      );
    }

    if (PaymentStateMachine.isSettled(order.paymentStatus)) {
      throw new BusinessRuleViolationException('This order has already been paid for.');
    }

    if (DEAD_STATUSES.includes(order.status)) {
      throw new BusinessRuleViolationException(
        `An order that is ${order.status.toLowerCase()} cannot take a payment.`,
      );
    }

    // A gateway order is settled by the gateway. Recording it by hand as well
    // is how one order ends up paid twice.
    if (
      order.status === OrderStatus.PENDING_PAYMENT ||
      !HAND_CONFIRMED_METHODS.includes(order.paymentMethod)
    ) {
      throw new BusinessRuleViolationException(
        'This order is being paid online, so the gateway confirms its payment.',
      );
    }

    const recipient: SettleManualTransferInput['recipient'] =
      as === ActorType.DRIVER ? 'RIDER' : as === ActorType.RESTAURANT ? 'RESTAURANT' : 'PLATFORM';

    const payee =
      recipient === 'RIDER'
        ? `rider ${order.driver?.user.fullName ?? ''}`.trim()
        : recipient === 'RESTAURANT'
          ? order.restaurant.name
          : 'ZassDelivery';

    const payment = await this.payments.settleManualTransfer({
      orderId: order.id,
      userId: order.customerId,
      amount: Number(order.totalAmount),
      channel: dto.channel,
      reference: dto.reference ?? null,
      recipient,
      recordedBy: actor.id,
      description: `Paid by ${PAYMENT_QR_PROVIDER_NAMES[dto.channel]} to ${payee}`,
    });

    return toPaymentDto(payment);
  }
}
