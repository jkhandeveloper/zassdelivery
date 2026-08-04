import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  PaymentMethod,
  PaymentStatus,
  TransactionStatus,
  TransactionType,
  WebhookStatus,
  type Transaction,
  type WebhookEvent,
} from '@prisma/client';

import type { PaymentWithContext } from '../../domain/repositories/payment.repository';
import { PaymentStateMachine } from '../../domain/services/payment-state';

export class PaymentDto {
  @ApiProperty() id!: string;
  @ApiPropertyOptional({
    nullable: true,
    example: 'PAY-260810-0001',
    description: 'Our merchant reference, quoted to the gateway and to support.',
  })
  reference!: string | null;

  @ApiProperty() orderId!: string;
  @ApiProperty({ example: 'ZD-260810-0007' }) orderNumber!: string;

  @ApiProperty({ enum: PaymentMethod }) method!: PaymentMethod;
  @ApiProperty({ enum: PaymentStatus }) status!: PaymentStatus;
  @ApiProperty({ example: 'Pay the rider when your order arrives' }) statusText!: string;

  @ApiProperty({ example: 1240 }) amount!: number;
  @ApiProperty({ example: 'PKR' }) currency!: string;
  @ApiProperty({ example: 0 }) refundedAmount!: number;
  @ApiProperty({ example: 1240, description: 'What can still be refunded on this attempt.' })
  refundableAmount!: number;

  @ApiPropertyOptional({ nullable: true, example: 'jazzcash' }) gateway!: string | null;
  @ApiPropertyOptional({
    nullable: true,
    example: 'T94057382',
    description: 'The gateway’s own transaction id, once it has issued one.',
  })
  gatewayTransactionId!: string | null;
  @ApiPropertyOptional({ nullable: true }) failureReason!: string | null;

  @ApiPropertyOptional({ nullable: true }) expiresAt!: Date | null;
  @ApiPropertyOptional({ nullable: true }) paidAt!: Date | null;
  @ApiPropertyOptional({ nullable: true }) failedAt!: Date | null;
  @ApiProperty() createdAt!: Date;
}

export class CheckoutFieldsDto {
  @ApiProperty({
    example: 'https://sandbox.jazzcash.com.pk/CustomerPortal/transactionmanagement/merchantform',
    description: 'Where the client posts the fields below.',
  })
  url!: string;

  @ApiProperty({ enum: ['POST', 'GET', 'REDIRECT'], example: 'POST' })
  method!: string;

  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'string' },
    description:
      'Signed form fields, rendered as hidden inputs and submitted to the URL ' +
      'above. Already signed — altering any value invalidates the request.',
  })
  fields!: Record<string, string>;
}

export class CheckoutDto {
  @ApiProperty({ type: PaymentDto }) payment!: PaymentDto;

  @ApiProperty({
    example: 'REDIRECT',
    enum: ['REDIRECT', 'SETTLED', 'ON_DELIVERY'],
    description:
      'REDIRECT — send the customer to the gateway. SETTLED — paid already, ' +
      'nothing more to do. ON_DELIVERY — the rider collects the cash.',
  })
  action!: 'REDIRECT' | 'SETTLED' | 'ON_DELIVERY';

  @ApiProperty({ example: 'Pay the rider Rs. 1240 when your order arrives.' })
  message!: string;

  @ApiPropertyOptional({
    type: CheckoutFieldsDto,
    description: 'Present only when action is REDIRECT.',
  })
  checkout?: CheckoutFieldsDto;
}

export class GatewayAvailabilityDto {
  @ApiProperty({ example: 'jazzcash' }) name!: string;
  @ApiProperty({ enum: PaymentMethod }) method!: PaymentMethod;
  @ApiProperty({
    example: false,
    description: 'False when this deployment holds no credentials for the provider.',
  })
  available!: boolean;
}

export class PaymentVerificationDto {
  @ApiProperty({ type: PaymentDto }) payment!: PaymentDto;
  @ApiProperty({
    example: true,
    description: 'Whether the payment is settled as of this check.',
  })
  settled!: boolean;
  @ApiProperty({ example: 'Payment confirmed by JazzCash.' }) message!: string;
  @ApiProperty({
    example: 'GATEWAY',
    enum: ['LOCAL', 'GATEWAY'],
    description:
      'LOCAL — answered from our own record. GATEWAY — we asked the provider, ' +
      'which is what happens when a callback never arrived.',
  })
  source!: 'LOCAL' | 'GATEWAY';
}

export class TransactionDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: TransactionType }) type!: TransactionType;
  @ApiProperty({ enum: TransactionStatus }) status!: TransactionStatus;
  @ApiProperty({ example: 1240 }) amount!: number;
  @ApiProperty({ example: 'PKR' }) currency!: string;
  @ApiProperty({ example: 'TXN-PAY-260810-0001-PAYMENT' }) reference!: string;
  @ApiPropertyOptional({ nullable: true }) description!: string | null;
  @ApiPropertyOptional({ nullable: true }) orderId!: string | null;
  @ApiPropertyOptional({ nullable: true }) paymentId!: string | null;
  @ApiPropertyOptional({ nullable: true }) processedAt!: Date | null;
  @ApiProperty() createdAt!: Date;
}

export class LedgerLineDto {
  @ApiProperty({ enum: TransactionType }) type!: TransactionType;
  @ApiProperty({ enum: TransactionStatus }) status!: TransactionStatus;
  @ApiProperty({ example: 41 }) count!: number;
  @ApiProperty({ example: 52340 }) amount!: number;
}

export class LedgerSummaryDto {
  @ApiProperty() from!: Date;
  @ApiProperty() to!: Date;
  @ApiProperty({ type: [LedgerLineDto] }) lines!: LedgerLineDto[];
  @ApiProperty({ example: 52340, description: 'Successful customer payments in the window.' })
  collected!: number;
  @ApiProperty({ example: 1200, description: 'Successful refunds in the window.' })
  refunded!: number;
  @ApiProperty({ example: 7851, description: 'Commission confirmed in the window.' })
  commission!: number;
  @ApiProperty({ example: 4300, description: 'Money paid out to riders in the window.' })
  payouts!: number;
  @ApiProperty({ example: 51140, description: 'Collected minus refunded.' }) net!: number;
}

export class WebhookEventDto {
  @ApiProperty() id!: string;
  @ApiProperty({ example: 'jazzcash' }) gateway!: string;
  @ApiProperty({ example: 'PAY-260810-0001' }) eventId!: string;
  @ApiProperty({ enum: WebhookStatus }) status!: WebhookStatus;
  @ApiPropertyOptional({ nullable: true }) paymentId!: string | null;
  @ApiPropertyOptional({ nullable: true }) error!: string | null;
  @ApiProperty({ example: 1, description: 'Deliveries received, including replays.' })
  attempts!: number;
  @ApiProperty() receivedAt!: Date;
  @ApiPropertyOptional({ nullable: true }) processedAt!: Date | null;
  @ApiPropertyOptional({
    description: 'The callback as received. Staff view only.',
    type: 'object',
    additionalProperties: true,
  })
  payload?: unknown;
}

export class InvoiceLineDto {
  @ApiProperty({ example: 'Chapli Kabab (Plate of 3) + 2× Naan' }) description!: string;
  @ApiProperty({ example: 1 }) quantity!: number;
  @ApiProperty({ example: 700 }) unitPrice!: number;
  @ApiProperty({ example: 760 }) amount!: number;
}

export class InvoiceTotalsDto {
  @ApiProperty({ example: 910 }) subtotal!: number;
  @ApiProperty({ example: 100 }) discountAmount!: number;
  @ApiProperty({ example: 69 }) deliveryFee!: number;
  @ApiProperty({ example: 46 }) serviceFee!: number;
  @ApiProperty({ example: 0 }) taxAmount!: number;
  @ApiProperty({ example: 0 }) tipAmount!: number;
  @ApiProperty({ example: 925 }) totalAmount!: number;
  @ApiProperty({ example: 'PKR' }) currency!: string;
}

export class InvoicePaymentDto {
  @ApiProperty({ enum: PaymentMethod }) method!: PaymentMethod;
  @ApiProperty({ enum: PaymentStatus }) status!: PaymentStatus;
  @ApiProperty({ example: 925 }) amount!: number;
  @ApiPropertyOptional({ nullable: true, example: 'PAY-260810-0001' }) reference!: string | null;
  @ApiPropertyOptional({ nullable: true, example: 'jazzcash' }) gateway!: string | null;
  @ApiPropertyOptional({ nullable: true }) gatewayTransactionId!: string | null;
  @ApiPropertyOptional({ nullable: true }) paidAt!: Date | null;
}

export class InvoiceRefundDto {
  @ApiProperty({ example: 250 }) amount!: number;
  @ApiProperty({ enum: TransactionStatus }) status!: TransactionStatus;
  @ApiPropertyOptional({ nullable: true }) reason!: string | null;
  @ApiProperty() issuedAt!: Date;
}

export class InvoiceDto {
  @ApiProperty({
    example: 'ZD-260810-0007',
    description: 'The order number doubles as the invoice number.',
  })
  invoiceNumber!: string;
  @ApiProperty() issuedAt!: Date;

  @ApiProperty({ example: 'Ahmad Khan' }) customerName!: string;
  @ApiProperty({ example: '+923001234567' }) customerPhone!: string;
  @ApiProperty({ example: 'House 14, Street 3, Gulshan Colony' }) deliveryAddress!: string;

  @ApiProperty({ example: 'Chapli Kabab House' }) restaurantName!: string;
  @ApiProperty({ example: 'Main GT Road, Pabbi' }) restaurantAddress!: string;

  @ApiProperty({ type: [InvoiceLineDto] }) lines!: InvoiceLineDto[];
  @ApiProperty({ type: InvoiceTotalsDto }) totals!: InvoiceTotalsDto;

  @ApiProperty({
    type: [InvoicePaymentDto],
    description: 'Every attempt against this order, failed ones included.',
  })
  payments!: InvoicePaymentDto[];

  @ApiProperty({ type: [InvoiceRefundDto] }) refunds!: InvoiceRefundDto[];

  @ApiProperty({ example: 925, description: 'Settled payments, less refunds.' })
  amountPaid!: number;
  @ApiProperty({ example: 0 }) amountRefunded!: number;
  @ApiProperty({ example: 0, description: 'Still owed. Non-zero for an unpaid cash order.' })
  amountDue!: number;

  @ApiProperty({ enum: PaymentStatus }) paymentStatus!: PaymentStatus;
  @ApiPropertyOptional({ nullable: true, example: 'ZASS100' }) couponCode!: string | null;
}

export class InvoiceSummaryDto {
  @ApiProperty({ example: 'ZD-260810-0007' }) invoiceNumber!: string;
  @ApiProperty() orderId!: string;
  @ApiProperty() issuedAt!: Date;
  @ApiProperty({ example: 'Chapli Kabab House' }) restaurantName!: string;
  @ApiProperty({ example: 925 }) totalAmount!: number;
  @ApiProperty({ example: 925 }) amountPaid!: number;
  @ApiProperty({ enum: PaymentStatus }) paymentStatus!: PaymentStatus;
  @ApiProperty({ enum: PaymentMethod }) paymentMethod!: PaymentMethod;
}

// ── Mappers ────────────────────────────────────────────────────

export function toPaymentDto(payment: PaymentWithContext, refunded?: number): PaymentDto {
  const amount = Number(payment.amount);
  const refundedAmount = refunded ?? Number(payment.refundedAmount);

  return {
    id: payment.id,
    reference: payment.reference,
    orderId: payment.orderId,
    orderNumber: payment.order.orderNumber,
    method: payment.method,
    status: payment.status,
    statusText: PaymentStateMachine.describe(payment.status, payment.method),
    amount,
    currency: payment.currency,
    refundedAmount,
    refundableAmount: PaymentStateMachine.isSettled(payment.status)
      ? Math.max(0, Math.round((amount - refundedAmount) * 100) / 100)
      : 0,
    gateway: payment.gatewayName,
    gatewayTransactionId: payment.gatewayTransactionId,
    failureReason: payment.failureReason,
    expiresAt: payment.expiresAt,
    paidAt: payment.paidAt,
    failedAt: payment.failedAt,
    createdAt: payment.createdAt,
  };
}

export function toTransactionDto(entry: Transaction): TransactionDto {
  return {
    id: entry.id,
    type: entry.type,
    status: entry.status,
    amount: Number(entry.amount),
    currency: entry.currency,
    reference: entry.reference,
    description: entry.description,
    orderId: entry.orderId,
    paymentId: entry.paymentId,
    processedAt: entry.processedAt,
    createdAt: entry.createdAt,
  };
}

export interface WebhookEventDtoOptions {
  /** The raw payload is a staff-only field: it carries gateway identifiers. */
  includePayload?: boolean;
}

export function toWebhookEventDto(
  event: WebhookEvent,
  options: WebhookEventDtoOptions = {},
): WebhookEventDto {
  return {
    id: event.id,
    gateway: event.gateway,
    eventId: event.eventId,
    status: event.status,
    paymentId: event.paymentId,
    error: event.error,
    attempts: event.attempts,
    receivedAt: event.receivedAt,
    processedAt: event.processedAt,
    ...(options.includePayload === true && { payload: event.payload }),
  };
}
