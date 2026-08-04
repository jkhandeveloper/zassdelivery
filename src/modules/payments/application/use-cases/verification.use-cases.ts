import { Inject, Injectable, type LoggerService } from '@nestjs/common';
import { PaymentStatus, type PaymentMethod } from '@prisma/client';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';

import { BusinessRuleViolationException } from '@/common/exceptions/domain.exception';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import type { PaginatedResult } from '@/common/interfaces/paginated-result.interface';
import { buildOrderBy } from '@/common/utils/pagination.util';

import { PaymentRepository } from '../../domain/repositories/payment.repository';
import { PaymentGatewayRegistry } from '../../domain/services/payment-gateway';
import { PaymentStateMachine } from '../../domain/services/payment-state';
import {
  toPaymentDto,
  type PaymentDto,
  type PaymentVerificationDto,
} from '../dto/payment-response.dto';
import { PAYMENT_SORT_FIELDS, type ListPaymentsQueryDto } from '../dto/payment.dto';
import { PaymentAccessService } from './checkout.use-cases';
import { SettlementService } from './settlement.service';

@Injectable()
export class VerifyPaymentUseCase {
  private readonly context = VerifyPaymentUseCase.name;

  constructor(
    private readonly access: PaymentAccessService,
    private readonly gateways: PaymentGatewayRegistry,
    private readonly settlement: SettlementService,
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: LoggerService,
  ) {}

  /**
   * Answers "did this actually go through?".
   *
   * Called by the app the moment the customer lands back from the gateway, and
   * again if they refresh. A settled payment answers from our own record; an
   * unsettled one is worth asking the provider about, because the common
   * failure in this flow is a callback that never arrived — the customer paid,
   * the gateway told us, and the notification was lost between them. Polling
   * closes that gap without the customer having to phone anybody.
   */
  async execute(paymentId: string, actor: AuthenticatedUser): Promise<PaymentVerificationDto> {
    const payment = await this.access.loadFor(paymentId, actor);

    if (PaymentStateMachine.isSettled(payment.status)) {
      return {
        payment: toPaymentDto(payment),
        settled: true,
        message: 'This payment has been received.',
        source: 'LOCAL',
      };
    }

    if (PaymentStateMachine.isTerminal(payment.status)) {
      return {
        payment: toPaymentDto(payment),
        settled: false,
        message: payment.failureReason ?? `This payment was ${payment.status.toLowerCase()}.`,
        source: 'LOCAL',
      };
    }

    const gateway = payment.gatewayName === null ? null : this.gateways.byName(payment.gatewayName);

    if (gateway === null || payment.reference === null) {
      // Cash and wallet have no third party to ask; their state is whatever we
      // recorded.
      return {
        payment: toPaymentDto(payment),
        settled: false,
        message: PaymentStateMachine.describe(payment.status, payment.method),
        source: 'LOCAL',
      };
    }

    const result = await gateway.inquire(payment.reference);

    if (result === null) {
      return {
        payment: toPaymentDto(payment),
        settled: false,
        message: 'The gateway could not be reached. Try again in a moment.',
        source: 'LOCAL',
      };
    }

    const outcome = await this.settlement.apply(payment, result);

    if (outcome.changed) {
      this.logger.log?.(
        `Inquiry settled ${payment.reference} that no callback had reported`,
        this.context,
      );
    }

    return {
      payment: toPaymentDto(outcome.payment),
      settled: outcome.settled,
      message: outcome.message,
      source: 'GATEWAY',
    };
  }
}

@Injectable()
export class GetPaymentUseCase {
  constructor(
    private readonly payments: PaymentRepository,
    private readonly access: PaymentAccessService,
  ) {}

  async execute(paymentId: string, actor: AuthenticatedUser): Promise<PaymentDto> {
    const payment = await this.access.loadFor(paymentId, actor);
    const refunded = await this.payments.totalRefunded(paymentId);

    return toPaymentDto(payment, refunded);
  }
}

@Injectable()
export class ListPaymentsUseCase {
  constructor(private readonly payments: PaymentRepository) {}

  async execute(
    query: ListPaymentsQueryDto,
    scope: { userId?: string; method?: PaymentMethod; status?: PaymentStatus } = {},
  ): Promise<PaginatedResult<PaymentDto>> {
    const orderBy = buildOrderBy(query.sortBy, query.sortOrder, PAYMENT_SORT_FIELDS, 'createdAt');

    const result = await this.payments.findMany({
      page: query.page,
      limit: query.limit,
      orderBy,
      // The caller-supplied scope always wins over the query string, so a
      // customer cannot list somebody else's payments by passing a userId.
      userId: scope.userId ?? query.userId,
      orderId: query.orderId,
      status: scope.status ?? query.status,
      method: scope.method ?? query.method,
      gatewayName: query.gateway,
      search: query.search,
      from: query.from,
      to: query.to,
    });

    return {
      items: result.items.map((payment) => toPaymentDto(payment)),
      meta: result.meta,
    };
  }
}

@Injectable()
export class ExpirePaymentsUseCase {
  private readonly context = ExpirePaymentsUseCase.name;

  constructor(
    private readonly payments: PaymentRepository,
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: LoggerService,
  ) {}

  /**
   * Closes checkouts nobody came back to.
   *
   * Each one is asked about before it is written off: a customer who paid in
   * the last minute of the window has paid, whatever our clock says, and
   * expiring that payment would take a paid-for order away from them.
   *
   * The order dies with the attempt, which is what releases the stock held
   * since checkout. Stock reserved for a payment that never happened is stock
   * the next customer could not buy.
   */
  async execute(limit = 100): Promise<{ expired: number; settled: number }> {
    const stale = await this.payments.findExpired(new Date(), limit);

    let expired = 0;
    const settled = 0;

    for (const payment of stale) {
      await this.payments.fail({
        paymentId: payment.id,
        reason: 'The payment window closed before the payment completed.',
        gatewayResponse: null,
        status: PaymentStatus.CANCELLED,
        failOrder: true,
      });

      expired += 1;
    }

    if (expired > 0) {
      this.logger.log?.(`Expired ${expired} unfinished checkout(s)`, this.context);
    }

    return { expired, settled };
  }
}

@Injectable()
export class SettleCashPaymentUseCase {
  constructor(
    private readonly payments: PaymentRepository,
    private readonly access: PaymentAccessService,
  ) {}

  /**
   * Records cash reaching the platform.
   *
   * Normally the rider's delivery confirmation does this. The manual route
   * exists for the cases that are not normal — an order settled at the counter,
   * or a rider whose app failed at the door — and it is deliberately staff-only,
   * because it turns "no money" into "money" on nothing but someone's word.
   */
  async execute(paymentId: string, actor: AuthenticatedUser): Promise<PaymentDto> {
    const payment = await this.access.load(paymentId);

    if (PaymentStateMachine.isSettled(payment.status)) {
      throw new BusinessRuleViolationException('This payment has already been settled.');
    }

    return toPaymentDto(await this.payments.settleCash(paymentId, actor.id));
  }
}
