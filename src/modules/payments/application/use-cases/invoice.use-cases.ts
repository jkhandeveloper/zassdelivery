import { Injectable } from '@nestjs/common';
import { OrderStatus, TransactionStatus, TransactionType, UserRole } from '@prisma/client';

import {
  BusinessRuleViolationException,
  ResourceNotFoundException,
} from '@/common/exceptions/domain.exception';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import type { PaginatedResult } from '@/common/interfaces/paginated-result.interface';
import {
  OrderRepository,
  type OrderWithDetails,
} from '@/modules/orders/domain/repositories/order.repository';

import { PaymentStateMachine } from '../../domain/services/payment-state';
import type { InvoiceDto, InvoiceSummaryDto } from '../dto/payment-response.dto';
import type { ListInvoicesQueryDto } from '../dto/payment.dto';

/** Statuses at which an order has committed to being owed for. */
const INVOICEABLE_FROM: OrderStatus[] = [
  OrderStatus.PLACED,
  OrderStatus.CONFIRMED,
  OrderStatus.PREPARING,
  OrderStatus.READY_FOR_PICKUP,
  OrderStatus.PICKED_UP,
  OrderStatus.ON_THE_WAY,
  OrderStatus.DELIVERED,
  OrderStatus.CANCELLED,
  OrderStatus.REJECTED,
  OrderStatus.FAILED,
];

/**
 * Builds the settlement view of an order.
 *
 * This is a different document from the customer's copy at `/orders/:id/invoice`,
 * which answers "what did I order and what did it cost". This one answers "what
 * was actually collected, how, and what came back" — every attempt including
 * the failed ones, gateway references, and each refund. It is the document a
 * finance team reconciles against a bank statement, and a support agent opens
 * when a customer says the money left their account.
 */
@Injectable()
export class InvoiceService {
  build(order: OrderWithDetails): InvoiceDto {
    const refunds = order.transactions.filter(
      (entry) =>
        entry.type === TransactionType.REFUND &&
        entry.status !== TransactionStatus.FAILED &&
        entry.status !== TransactionStatus.REVERSED,
    );

    const amountRefunded =
      Math.round(refunds.reduce((sum, entry) => sum + Number(entry.amount), 0) * 100) / 100;

    const amountPaid =
      Math.round(
        order.payments
          .filter((payment) => PaymentStateMachine.isSettled(payment.status))
          .reduce((sum, payment) => sum + Number(payment.amount), 0) * 100,
      ) / 100;

    const total = Number(order.totalAmount);

    return {
      // One reference for the customer, the kitchen, support and finance to
      // quote; a separate invoice series would only be a second thing to
      // reconcile.
      invoiceNumber: order.orderNumber,
      issuedAt: order.placedAt ?? order.createdAt,
      customerName: order.recipientName ?? order.customer.fullName,
      customerPhone: order.recipientPhone ?? order.customer.phone,
      deliveryAddress: [order.deliveryLine1, order.deliveryLandmark]
        .filter((part) => part !== null && part !== '')
        .join(', '),
      restaurantName: order.restaurant.name,
      restaurantAddress: order.restaurant.addressLine,
      lines: order.items.map((line) => ({
        description: [
          line.nameSnapshot,
          line.variantNameSnapshot === null ? null : `(${line.variantNameSnapshot})`,
          line.addOns.length === 0
            ? null
            : `+ ${line.addOns.map((addOn) => `${addOn.quantity}× ${addOn.nameSnapshot}`).join(', ')}`,
        ]
          .filter((part) => part !== null)
          .join(' '),
        quantity: line.quantity,
        unitPrice: Number(line.unitPrice),
        amount: Number(line.lineTotal),
      })),
      totals: {
        subtotal: Number(order.subtotal),
        discountAmount: Number(order.discountAmount),
        deliveryFee: Number(order.deliveryFee),
        serviceFee: Number(order.serviceFee),
        taxAmount: Number(order.taxAmount),
        tipAmount: Number(order.tipAmount),
        totalAmount: total,
        currency: order.currency,
      },
      // Failed attempts are listed too. "I tried three times and it kept
      // declining" is a support conversation this table answers on its own.
      payments: order.payments.map((payment) => ({
        method: payment.method,
        status: payment.status,
        amount: Number(payment.amount),
        reference: payment.reference,
        gateway: payment.gatewayName,
        gatewayTransactionId: payment.gatewayTransactionId,
        paidAt: payment.paidAt,
      })),
      refunds: refunds.map((entry) => ({
        amount: Number(entry.amount),
        status: entry.status,
        reason: entry.description,
        issuedAt: entry.processedAt ?? entry.createdAt,
      })),
      amountPaid: Math.round((amountPaid - amountRefunded) * 100) / 100,
      amountRefunded,
      // What the customer still owes. Non-zero for a cash order in flight,
      // which is exactly the number a rider needs at the door.
      amountDue: Math.max(0, Math.round((total - amountPaid) * 100) / 100),
      paymentStatus: order.paymentStatus,
      couponCode: order.couponCode,
    };
  }

  summarise(order: OrderWithDetails): InvoiceSummaryDto {
    const invoice = this.build(order);

    return {
      invoiceNumber: invoice.invoiceNumber,
      orderId: order.id,
      issuedAt: invoice.issuedAt,
      restaurantName: invoice.restaurantName,
      totalAmount: invoice.totals.totalAmount,
      amountPaid: invoice.amountPaid,
      paymentStatus: order.paymentStatus,
      paymentMethod: order.paymentMethod,
    };
  }
}

@Injectable()
export class GetInvoiceUseCase {
  constructor(
    private readonly orders: OrderRepository,
    private readonly invoices: InvoiceService,
  ) {}

  async execute(orderId: string, actor: AuthenticatedUser): Promise<InvoiceDto> {
    const order = await this.orders.findById(orderId);
    const isStaff = actor.role === UserRole.ADMIN || actor.role === UserRole.SUPER_ADMIN;

    if (!order || (!isStaff && order.customerId !== actor.id)) {
      throw new ResourceNotFoundException('Invoice', orderId);
    }

    // An order nobody has committed to yet is a basket with a number on it.
    if (!INVOICEABLE_FROM.includes(order.status)) {
      throw new BusinessRuleViolationException(
        'An invoice is available once the order has been placed.',
      );
    }

    return this.invoices.build(order);
  }
}

@Injectable()
export class ListInvoicesUseCase {
  constructor(
    private readonly orders: OrderRepository,
    private readonly invoices: InvoiceService,
  ) {}

  /**
   * The invoice index — a customer's receipts, or the whole book for finance.
   *
   * Deliberately a summary per order rather than a full document each: the list
   * screen shows what was owed and what was paid, and the document is one tap
   * away.
   */
  async execute(
    query: ListInvoicesQueryDto,
    scope: { customerId?: string } = {},
  ): Promise<PaginatedResult<InvoiceSummaryDto>> {
    const result = await this.orders.findMany({
      page: query.page,
      limit: query.limit,
      orderBy: { createdAt: 'desc' },
      customerId: scope.customerId ?? query.userId,
      paymentStatus: query.paymentStatus,
      search: query.search,
      from: query.from,
      to: query.to,
    });

    return {
      items: result.items
        .filter((order) => INVOICEABLE_FROM.includes(order.status))
        .map((order) => this.invoices.summarise(order)),
      meta: result.meta,
    };
  }
}

export { INVOICEABLE_FROM };
