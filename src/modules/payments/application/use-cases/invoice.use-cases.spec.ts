import {
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  TransactionStatus,
  TransactionType,
} from '@prisma/client';

import type { OrderWithDetails } from '@/modules/orders/domain/repositories/order.repository';

import { InvoiceService } from './invoice.use-cases';

function order(overrides: Partial<OrderWithDetails> = {}): OrderWithDetails {
  return {
    id: 'order-1',
    orderNumber: 'ZD-260810-0007',
    status: OrderStatus.DELIVERED,
    customerId: 'user-1',
    subtotal: 910,
    discountAmount: 100,
    deliveryFee: 69,
    serviceFee: 46,
    taxAmount: 0,
    tipAmount: 0,
    totalAmount: 925,
    currency: 'PKR',
    couponCode: 'ZASS100',
    paymentMethod: PaymentMethod.JAZZCASH,
    paymentStatus: PaymentStatus.PAID,
    deliveryLine1: 'House 14, Street 3, Gulshan Colony',
    deliveryLandmark: 'Near Pabbi Bus Stand',
    recipientName: null,
    recipientPhone: null,
    placedAt: new Date('2026-08-10T10:00:00.000Z'),
    createdAt: new Date('2026-08-10T09:59:00.000Z'),
    customer: { id: 'user-1', fullName: 'Ahmad Khan', phone: '+923001234567' },
    restaurant: { name: 'Chapli Kabab House', addressLine: 'Main GT Road, Pabbi' },
    items: [
      {
        nameSnapshot: 'Chapli Kabab',
        variantNameSnapshot: 'Plate of 3',
        unitPrice: 700,
        quantity: 1,
        lineTotal: 760,
        addOns: [{ nameSnapshot: 'Naan', quantity: 2, price: 30 }],
      },
    ],
    payments: [],
    transactions: [],
    ...overrides,
  } as unknown as OrderWithDetails;
}

function payment(overrides: Record<string, unknown> = {}) {
  return {
    method: PaymentMethod.JAZZCASH,
    status: PaymentStatus.PAID,
    amount: 925,
    reference: 'PAY-260810-0001',
    gatewayName: 'jazzcash',
    gatewayTransactionId: 'T940',
    paidAt: new Date('2026-08-10T10:01:00.000Z'),
    ...overrides,
  } as unknown as OrderWithDetails['payments'][number];
}

function refund(amount: number, status: TransactionStatus = TransactionStatus.SUCCESS) {
  return {
    type: TransactionType.REFUND,
    status,
    amount,
    description: 'Items missing',
    processedAt: new Date('2026-08-10T12:00:00.000Z'),
    createdAt: new Date('2026-08-10T12:00:00.000Z'),
  } as unknown as OrderWithDetails['transactions'][number];
}

describe('InvoiceService.build', () => {
  const service = new InvoiceService();

  it('uses the order number as the invoice number', () => {
    expect(service.build(order()).invoiceNumber).toBe('ZD-260810-0007');
  });

  it('itemises the lines with their add-ons spelled out', () => {
    const invoice = service.build(order());

    expect(invoice.lines[0]?.description).toBe('Chapli Kabab (Plate of 3) + 2× Naan');
    expect(invoice.lines[0]?.amount).toBe(760);
  });

  it('carries the totals through unchanged', () => {
    const invoice = service.build(order());

    expect(invoice.totals).toMatchObject({
      subtotal: 910,
      discountAmount: 100,
      deliveryFee: 69,
      serviceFee: 46,
      totalAmount: 925,
      currency: 'PKR',
    });
  });

  it('lists failed attempts alongside the successful one', () => {
    const invoice = service.build(
      order({
        payments: [
          payment({ status: PaymentStatus.FAILED, reference: 'PAY-260810-0001', paidAt: null }),
          payment({ reference: 'PAY-260810-0002' }),
        ] as OrderWithDetails['payments'],
      }),
    );

    // "I tried twice and it kept declining" is answered by this table alone.
    expect(invoice.payments).toHaveLength(2);
    expect(invoice.payments[0]?.status).toBe(PaymentStatus.FAILED);
  });

  it('counts only settled attempts towards what was paid', () => {
    const invoice = service.build(
      order({
        payments: [
          payment({ status: PaymentStatus.FAILED }),
          payment(),
        ] as OrderWithDetails['payments'],
      }),
    );

    expect(invoice.amountPaid).toBe(925);
    expect(invoice.amountDue).toBe(0);
  });

  it('shows what is still owed on an unpaid cash order', () => {
    const invoice = service.build(
      order({
        paymentMethod: PaymentMethod.CASH_ON_DELIVERY,
        paymentStatus: PaymentStatus.PENDING,
        payments: [
          payment({
            method: PaymentMethod.CASH_ON_DELIVERY,
            status: PaymentStatus.PENDING,
            gatewayName: null,
            paidAt: null,
          }),
        ] as OrderWithDetails['payments'],
      }),
    );

    // Exactly the figure a rider needs at the door.
    expect(invoice.amountDue).toBe(925);
    expect(invoice.amountPaid).toBe(0);
  });

  it('nets refunds off what was paid', () => {
    const invoice = service.build(
      order({
        payments: [payment()] as OrderWithDetails['payments'],
        transactions: [refund(250)] as OrderWithDetails['transactions'],
      }),
    );

    expect(invoice.amountRefunded).toBe(250);
    expect(invoice.amountPaid).toBe(675);
  });

  it('counts a refund the gateway is still processing, because it is promised', () => {
    const invoice = service.build(
      order({
        payments: [payment()] as OrderWithDetails['payments'],
        transactions: [refund(250, TransactionStatus.PENDING)] as OrderWithDetails['transactions'],
      }),
    );

    expect(invoice.amountRefunded).toBe(250);
  });

  it('ignores a refund that failed outright', () => {
    const invoice = service.build(
      order({
        payments: [payment()] as OrderWithDetails['payments'],
        transactions: [refund(250, TransactionStatus.FAILED)] as OrderWithDetails['transactions'],
      }),
    );

    expect(invoice.amountRefunded).toBe(0);
    expect(invoice.refunds).toHaveLength(0);
  });

  it('leaves out transactions that are not refunds', () => {
    const invoice = service.build(
      order({
        transactions: [
          { type: TransactionType.COMMISSION, status: TransactionStatus.SUCCESS, amount: 136 },
        ] as unknown as OrderWithDetails['transactions'],
      }),
    );

    expect(invoice.refunds).toHaveLength(0);
  });

  it('prefers the recipient on the order over the account holder', () => {
    const invoice = service.build(
      order({ recipientName: 'Sana Bibi', recipientPhone: '+923007654321' }),
    );

    expect(invoice.customerName).toBe('Sana Bibi');
    expect(invoice.customerPhone).toBe('+923007654321');
  });

  it('joins the address with its landmark', () => {
    expect(service.build(order()).deliveryAddress).toBe(
      'House 14, Street 3, Gulshan Colony, Near Pabbi Bus Stand',
    );
  });

  it('never reports a negative amount due when an order was overpaid', () => {
    const invoice = service.build(
      order({ payments: [payment({ amount: 1000 })] as OrderWithDetails['payments'] }),
    );

    expect(invoice.amountDue).toBe(0);
  });
});

describe('InvoiceService.summarise', () => {
  const service = new InvoiceService();

  it('reduces an invoice to what a list screen shows', () => {
    const summary = service.summarise(
      order({ payments: [payment()] as OrderWithDetails['payments'] }),
    );

    expect(summary).toMatchObject({
      invoiceNumber: 'ZD-260810-0007',
      orderId: 'order-1',
      restaurantName: 'Chapli Kabab House',
      totalAmount: 925,
      amountPaid: 925,
      paymentStatus: PaymentStatus.PAID,
      paymentMethod: PaymentMethod.JAZZCASH,
    });
  });
});
