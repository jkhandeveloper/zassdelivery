import { Inject, Injectable, type LoggerService } from '@nestjs/common';
import { PaymentMethod, TransactionStatus } from '@prisma/client';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';

import { BusinessRuleViolationException } from '@/common/exceptions/domain.exception';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';

import { PaymentRepository } from '../../domain/repositories/payment.repository';
import { PaymentGatewayRegistry } from '../../domain/services/payment-gateway';
import { PaymentStateMachine } from '../../domain/services/payment-state';
import { toPaymentDto, type PaymentDto } from '../dto/payment-response.dto';
import type { RefundPaymentDto } from '../dto/payment.dto';
import { PaymentAccessService } from './checkout.use-cases';

export interface RefundOutcome {
  payment: PaymentDto;
  refunded: number;
  totalRefunded: number;
  /** Where the money actually went, which is not always where it was asked to go. */
  destination: 'GATEWAY' | 'WALLET';
  /** False while a gateway is still processing the return. */
  immediate: boolean;
  message: string;
}

@Injectable()
export class RefundPaymentUseCase {
  private readonly context = RefundPaymentUseCase.name;

  constructor(
    private readonly payments: PaymentRepository,
    private readonly access: PaymentAccessService,
    private readonly gateways: PaymentGatewayRegistry,
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: LoggerService,
  ) {}

  /**
   * Returns money against a settled payment.
   *
   * Refunds are additive rather than a reversal: nothing about the original
   * payment is rewritten, and the correction lives in the ledger where it can
   * be audited. Partial refunds accumulate and can never exceed what was taken.
   *
   * Where the money goes is decided here rather than by the caller alone.
   * Asking for the original instrument is the right default — that is where the
   * customer expects it — but a gateway that refuses, or is not configured on
   * this deployment, must not leave the customer with nothing. In that case the
   * wallet takes it and the response says so, because a refund that silently
   * went somewhere else is worse than one that did not happen.
   */
  async execute(
    paymentId: string,
    dto: RefundPaymentDto,
    actor: AuthenticatedUser,
  ): Promise<RefundOutcome> {
    const payment = await this.access.load(paymentId);
    const alreadyRefunded = await this.payments.totalRefunded(paymentId);

    const refundable = PaymentStateMachine.refundableAmount(
      payment.status,
      Number(payment.amount),
      alreadyRefunded,
    );

    const requested = dto.amount ?? refundable;

    if (requested > refundable) {
      throw new BusinessRuleViolationException(
        `At most Rs. ${refundable} can still be refunded on this payment.`,
      );
    }

    const target = dto.destination ?? 'SOURCE';
    const gateway = payment.gatewayName === null ? null : this.gateways.byName(payment.gatewayName);

    // Cash never went through an instrument to return it to, so it comes back
    // as wallet credit whatever was asked for.
    const canReturnToSource =
      target === 'SOURCE' &&
      gateway !== null &&
      gateway.isConfigured() &&
      payment.method !== PaymentMethod.CASH_ON_DELIVERY;

    if (!canReturnToSource) {
      return this.toWallet(payment.id, payment, requested, alreadyRefunded, dto.reason, actor, {
        method: payment.method,
        askedForSource: target === 'SOURCE',
        gatewayTried: false,
      });
    }

    const result = await gateway.refund({
      reference: payment.reference ?? payment.id,
      gatewayTransactionId: payment.gatewayTransactionId,
      amount: requested,
      reason: dto.reason,
    });

    if (!result.accepted) {
      this.logger.warn?.(
        `${payment.gatewayName} refused a refund on ${payment.reference}: ${result.message ?? 'no reason given'}`,
        this.context,
      );

      return this.toWallet(payment.id, payment, requested, alreadyRefunded, dto.reason, actor, {
        method: payment.method,
        askedForSource: true,
        gatewayTried: true,
        gatewayRefusal: result.message,
      });
    }

    await this.payments.recordRefund({
      paymentId: payment.id,
      orderId: payment.orderId,
      userId: payment.userId,
      amount: requested,
      reason: dto.reason,
      destination: 'GATEWAY',
      gatewayRefundId: result.gatewayRefundId,
      // A gateway that has accepted a refund has not yet made one; the money
      // reaches the customer on the provider's timetable, and the ledger says
      // PENDING until it does.
      status: result.outcome === 'REFUNDED' ? TransactionStatus.SUCCESS : TransactionStatus.PENDING,
      actorId: actor.id,
    });

    const updated = await this.access.load(paymentId);

    this.logger.log?.(
      `Refunded Rs. ${requested} of ${payment.reference} to ${payment.gatewayName}`,
      this.context,
    );

    return {
      payment: toPaymentDto(updated, alreadyRefunded + requested),
      refunded: requested,
      totalRefunded: alreadyRefunded + requested,
      destination: 'GATEWAY',
      immediate: result.outcome === 'REFUNDED',
      message:
        result.outcome === 'REFUNDED'
          ? `Rs. ${requested} returned to the customer's ${payment.method.toLowerCase()} account.`
          : `Rs. ${requested} sent to ${payment.gatewayName} for return. It reaches the customer on the provider's timetable.`,
    };
  }

  private async toWallet(
    paymentId: string,
    payment: { orderId: string; userId: string },
    amount: number,
    alreadyRefunded: number,
    reason: string,
    actor: AuthenticatedUser,
    context: {
      method: PaymentMethod;
      askedForSource: boolean;
      /** Whether the gateway was actually asked, as opposed to never tried. */
      gatewayTried: boolean;
      gatewayRefusal?: string | null;
    },
  ): Promise<RefundOutcome> {
    await this.payments.recordRefund({
      paymentId,
      orderId: payment.orderId,
      userId: payment.userId,
      amount,
      reason,
      destination: 'WALLET',
      gatewayRefundId: null,
      status: TransactionStatus.SUCCESS,
      actorId: actor.id,
    });

    const updated = await this.access.load(paymentId);

    // The customer is told which way the money came back, and why, rather than
    // being left to discover it in their wallet. Each branch is a genuinely
    // different situation: the gateway said no, the gateway was never asked, or
    // there was never an instrument to return to.
    const explanation = this.explain(context);

    return {
      payment: toPaymentDto(updated, alreadyRefunded + amount),
      refunded: amount,
      totalRefunded: alreadyRefunded + amount,
      destination: 'WALLET',
      immediate: true,
      message: `Rs. ${amount} credited to the customer's wallet.${explanation}`,
    };
  }

  private explain(context: {
    method: PaymentMethod;
    askedForSource: boolean;
    gatewayTried: boolean;
    gatewayRefusal?: string | null;
  }): string {
    if (!context.askedForSource) {
      return '';
    }

    if (context.gatewayTried) {
      return context.gatewayRefusal === undefined ||
        context.gatewayRefusal === null ||
        context.gatewayRefusal === ''
        ? ' The gateway refused the return without giving a reason.'
        : ` The gateway refused the return (${context.gatewayRefusal}).`;
    }

    return context.method === PaymentMethod.CASH_ON_DELIVERY
      ? ' Cash orders have no instrument to return to.'
      : ' The original payment method is not available for refunds on this deployment.';
  }
}
