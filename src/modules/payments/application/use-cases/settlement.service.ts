import { Inject, Injectable, type LoggerService } from '@nestjs/common';
import { PaymentStatus } from '@prisma/client';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import type { Prisma } from '@prisma/client';

import {
  PaymentRepository,
  type PaymentWithContext,
} from '../../domain/repositories/payment.repository';
import type { GatewayResult } from '../../domain/services/payment-gateway';
import { PaymentStateMachine } from '../../domain/services/payment-state';

export interface SettlementOutcome {
  payment: PaymentWithContext;
  /** Whether this call is what moved the payment, as opposed to finding it done. */
  changed: boolean;
  settled: boolean;
  message: string;
}

/**
 * Applies a gateway's verdict to a payment.
 *
 * The one place a gateway result turns into a state change, because there are
 * three ways such a result arrives — a webhook, the customer's browser coming
 * back, and us asking the provider — and all three must reach exactly the same
 * conclusion. Three copies of this logic would eventually disagree, and the
 * disagreement would be about whether somebody had paid.
 */
@Injectable()
export class SettlementService {
  private readonly context = SettlementService.name;

  constructor(
    private readonly payments: PaymentRepository,
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: LoggerService,
  ) {}

  async apply(payment: PaymentWithContext, result: GatewayResult): Promise<SettlementOutcome> {
    if (PaymentStateMachine.isSettled(payment.status)) {
      return {
        payment,
        changed: false,
        settled: true,
        message: 'This payment was already settled.',
      };
    }

    const raw = result.raw as Prisma.InputJsonValue;

    switch (result.outcome) {
      case 'PAID':
      case 'AUTHORIZED': {
        // The amount is checked before anything is credited. A gateway
        // reporting a smaller sum than the order is worth is either a partial
        // capture or a tampered callback, and neither should quietly release an
        // order to the kitchen.
        const mismatch = this.amountMismatch(payment, result);

        if (mismatch !== null) {
          const failed = await this.payments.fail({
            paymentId: payment.id,
            reason: mismatch,
            gatewayResponse: raw,
            status: PaymentStatus.FAILED,
            failOrder: false,
          });

          this.logger.error?.(
            `Amount mismatch on ${payment.reference}: ${mismatch}`,
            undefined,
            this.context,
          );

          return { payment: failed, changed: true, settled: false, message: mismatch };
        }

        const settled = await this.payments.settle({
          paymentId: payment.id,
          gatewayTransactionId: result.gatewayTransactionId,
          gatewayResponse: raw,
          status: result.outcome === 'PAID' ? PaymentStatus.PAID : PaymentStatus.AUTHORIZED,
        });

        this.logger.log?.(
          `Payment ${payment.reference} ${result.outcome.toLowerCase()} for order ${payment.order.orderNumber}`,
          this.context,
        );

        return {
          payment: settled,
          changed: true,
          settled: result.outcome === 'PAID',
          message:
            result.outcome === 'PAID'
              ? 'Payment confirmed.'
              : 'Payment authorised, awaiting capture.',
        };
      }

      case 'FAILED':
      case 'CANCELLED': {
        const reason = result.message ?? `The payment was ${result.outcome.toLowerCase()}.`;

        const failed = await this.payments.fail({
          paymentId: payment.id,
          reason: result.code === null ? reason : `${reason} (${result.code})`,
          gatewayResponse: raw,
          status: result.outcome === 'CANCELLED' ? PaymentStatus.CANCELLED : PaymentStatus.FAILED,
          // The order stays open so the customer can try another method. It is
          // released only when the checkout window itself expires.
          failOrder: false,
        });

        return { payment: failed, changed: true, settled: false, message: reason };
      }

      default:
        // The customer is mid-payment. Recording anything now would be guessing.
        return {
          payment,
          changed: false,
          settled: false,
          message: result.message ?? 'The payment is still in progress.',
        };
    }
  }

  /**
   * Whether the gateway's amount disagrees with what the order costs.
   *
   * A tolerance of one rupee absorbs the rounding that happens when an amount
   * makes the round trip through paisa; anything larger is a real difference.
   */
  private amountMismatch(payment: PaymentWithContext, result: GatewayResult): string | null {
    if (result.amount === null) {
      return null;
    }

    const expected = Number(payment.amount);
    const difference = Math.abs(expected - result.amount);

    return difference > 1
      ? `The gateway reported Rs. ${result.amount} against an expected Rs. ${expected}.`
      : null;
  }
}
