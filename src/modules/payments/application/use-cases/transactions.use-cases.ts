import { Injectable } from '@nestjs/common';
import { TransactionStatus, TransactionType } from '@prisma/client';

import { ResourceNotFoundException } from '@/common/exceptions/domain.exception';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import type { PaginatedResult } from '@/common/interfaces/paginated-result.interface';
import { buildOrderBy } from '@/common/utils/pagination.util';
import { OrderRepository } from '@/modules/orders/domain/repositories/order.repository';

import { PaymentRepository } from '../../domain/repositories/payment.repository';
import {
  toTransactionDto,
  type LedgerSummaryDto,
  type TransactionDto,
} from '../dto/payment-response.dto';
import {
  TRANSACTION_SORT_FIELDS,
  type LedgerSummaryQueryDto,
  type ListTransactionsQueryDto,
} from '../dto/payment.dto';
import { PaymentAccessService } from './checkout.use-cases';

@Injectable()
export class ListTransactionsUseCase {
  constructor(private readonly payments: PaymentRepository) {}

  /**
   * The money-movement log.
   *
   * The ledger is append-only, so this is a straight read: nothing here can be
   * edited, and a correction is a new row rather than a rewrite of an old one.
   */
  async execute(
    query: ListTransactionsQueryDto,
    scope: { userId?: string } = {},
  ): Promise<PaginatedResult<TransactionDto>> {
    const orderBy = buildOrderBy(
      query.sortBy,
      query.sortOrder,
      TRANSACTION_SORT_FIELDS,
      'createdAt',
    );

    const result = await this.payments.listTransactions({
      page: query.page,
      limit: query.limit,
      orderBy,
      // The scope wins over the query string, so a customer cannot read
      // somebody else's ledger by passing their id.
      userId: scope.userId ?? query.userId,
      orderId: query.orderId,
      paymentId: query.paymentId,
      type: query.type,
      status: query.status,
      search: query.search,
      from: query.from,
      to: query.to,
    });

    return { items: result.items.map(toTransactionDto), meta: result.meta };
  }
}

@Injectable()
export class OrderTransactionsUseCase {
  constructor(
    private readonly payments: PaymentRepository,
    private readonly orders: OrderRepository,
  ) {}

  /** Every movement of money against one order, for a support conversation. */
  async execute(orderId: string, actor: AuthenticatedUser): Promise<TransactionDto[]> {
    const order = await this.orders.findById(orderId);

    if (!order || (!PaymentAccessService.isStaff(actor) && order.customerId !== actor.id)) {
      throw new ResourceNotFoundException('Order', orderId);
    }

    const result = await this.payments.listTransactions({
      page: 1,
      limit: 100,
      orderBy: { createdAt: 'asc' },
      orderId,
    });

    return result.items.map(toTransactionDto);
  }
}

@Injectable()
export class LedgerSummaryUseCase {
  constructor(private readonly payments: PaymentRepository) {}

  /**
   * What moved over a window, grouped by kind.
   *
   * The number a finance team reconciles against the bank is `collected`, and
   * it counts only what actually succeeded — a pending refund is money promised
   * but not yet gone, and folding it in would make the day look worse than it
   * was until the provider caught up.
   */
  async execute(query: LedgerSummaryQueryDto): Promise<LedgerSummaryDto> {
    const to = query.to ?? new Date();
    const from = query.from ?? new Date(new Date(to).setHours(0, 0, 0, 0));

    const lines = await this.payments.summariseTransactions(from, to);

    const sum = (type: TransactionType): number =>
      Math.round(
        lines
          .filter((line) => line.type === type && line.status === TransactionStatus.SUCCESS)
          .reduce((total, line) => total + line.amount, 0) * 100,
      ) / 100;

    const collected = sum(TransactionType.PAYMENT);
    const refunded = sum(TransactionType.REFUND);

    return {
      from,
      to,
      lines,
      collected,
      refunded,
      commission: sum(TransactionType.COMMISSION),
      payouts: sum(TransactionType.PAYOUT),
      net: Math.round((collected - refunded) * 100) / 100,
    };
  }
}
