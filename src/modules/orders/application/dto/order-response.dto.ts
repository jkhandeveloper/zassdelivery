import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ActorType, OrderStatus, OrderType, PaymentMethod, PaymentStatus } from '@prisma/client';

import { OrderStateMachine } from '../../domain/services/order-state-machine';
import type { OrderWithDetails } from '../../domain/repositories/order.repository';

export class OrderItemAddOnDto {
  @ApiProperty({ example: 'Naan' }) name!: string;
  @ApiProperty({ example: 30 }) price!: number;
  @ApiProperty({ example: 2 }) quantity!: number;
}

export class OrderItemDto {
  @ApiProperty() id!: string;
  @ApiPropertyOptional({
    nullable: true,
    description: 'Null once the dish is removed from the menu.',
  })
  menuItemId!: string | null;
  @ApiProperty({ example: 'Chapli Kabab' }) name!: string;
  @ApiPropertyOptional({ nullable: true, example: 'Plate of 3' }) variantName!: string | null;
  @ApiProperty({ example: 700 }) unitPrice!: number;
  @ApiProperty({ example: 1 }) quantity!: number;
  @ApiProperty({ example: 760 }) lineTotal!: number;
  @ApiPropertyOptional({ nullable: true }) notes!: string | null;
  @ApiProperty({ type: [OrderItemAddOnDto] }) addOns!: OrderItemAddOnDto[];
}

export class OrderTotalsDto {
  @ApiProperty({ example: 910 }) subtotal!: number;
  @ApiProperty({ example: 100 }) discountAmount!: number;
  @ApiProperty({ example: 69 }) deliveryFee!: number;
  @ApiProperty({ example: 41 }) serviceFee!: number;
  @ApiProperty({ example: 0 }) taxAmount!: number;
  @ApiProperty({ example: 0 }) tipAmount!: number;
  @ApiProperty({ example: 920 }) totalAmount!: number;
  @ApiProperty({ example: 'PKR' }) currency!: string;
}

export class OrderTimelineEntryDto {
  @ApiPropertyOptional({ nullable: true, enum: OrderStatus }) fromStatus!: OrderStatus | null;
  @ApiProperty({ enum: OrderStatus }) toStatus!: OrderStatus;
  @ApiProperty({ enum: ActorType }) actor!: ActorType;
  @ApiProperty({ example: 'Accepted by restaurant' }) label!: string;
  @ApiPropertyOptional({ nullable: true }) note!: string | null;
  @ApiProperty() at!: Date;
}

export class OrderTransactionDto {
  @ApiProperty() id!: string;
  @ApiProperty({ example: 'PAYMENT' }) type!: string;
  @ApiProperty({ example: 'SUCCESS' }) status!: string;
  @ApiProperty({ example: 1025 }) amount!: number;
  @ApiProperty({ example: 'TXN-ZD-260804-0001-PAYMENT' }) reference!: string;
  @ApiPropertyOptional({ nullable: true }) description!: string | null;
  @ApiProperty() createdAt!: Date;
}

export class OrderPartyDto {
  @ApiProperty() id!: string;
  @ApiProperty({ example: 'Chapli Kabab House' }) name!: string;
  @ApiPropertyOptional({ nullable: true, example: '+923005551234' }) phone!: string | null;
}

export class OrderDto {
  @ApiProperty() id!: string;
  @ApiProperty({ example: 'ZD-260804-0001' }) orderNumber!: string;
  @ApiProperty({ enum: OrderStatus }) status!: OrderStatus;
  @ApiProperty({ example: 'Being prepared', description: 'Customer-facing status text.' })
  statusText!: string;
  @ApiProperty({ enum: OrderType }) type!: OrderType;

  @ApiProperty({ type: OrderPartyDto }) restaurant!: OrderPartyDto;
  @ApiPropertyOptional({ type: OrderPartyDto, nullable: true }) driver!: OrderPartyDto | null;

  @ApiProperty({ type: [OrderItemDto] }) items!: OrderItemDto[];
  @ApiProperty({ type: OrderTotalsDto }) totals!: OrderTotalsDto;

  @ApiProperty({ enum: PaymentMethod }) paymentMethod!: PaymentMethod;
  @ApiProperty({ enum: PaymentStatus }) paymentStatus!: PaymentStatus;
  @ApiPropertyOptional({ nullable: true, example: 'ZASS100' }) couponCode!: string | null;

  @ApiProperty({ example: 'House 14, Street 3, Gulshan Colony' }) deliveryAddress!: string;
  @ApiPropertyOptional({ nullable: true }) deliveryLandmark!: string | null;
  @ApiPropertyOptional({ nullable: true }) deliveryNotes!: string | null;
  @ApiPropertyOptional({ nullable: true, example: 2.4 }) distanceKm!: number | null;

  @ApiPropertyOptional({ nullable: true }) estimatedDeliveryAt!: Date | null;
  @ApiPropertyOptional({ nullable: true }) placedAt!: Date | null;
  @ApiPropertyOptional({ nullable: true }) deliveredAt!: Date | null;
  @ApiPropertyOptional({ nullable: true }) cancelledAt!: Date | null;
  @ApiPropertyOptional({ nullable: true, enum: ActorType }) cancelledBy!: ActorType | null;
  @ApiPropertyOptional({ nullable: true }) cancellationReason!: string | null;

  @ApiProperty({
    type: [String],
    enum: OrderStatus,
    description: 'Statuses this order can legally move to next, for the caller’s role.',
  })
  allowedTransitions!: OrderStatus[];

  @ApiProperty({ example: false, description: 'Whether the customer may still cancel.' })
  canCancel!: boolean;

  @ApiProperty({ type: [OrderTimelineEntryDto] }) timeline!: OrderTimelineEntryDto[];
  @ApiPropertyOptional({ type: [OrderTransactionDto] }) transactions?: OrderTransactionDto[];

  @ApiProperty() createdAt!: Date;
}

export class InvoiceLineDto {
  @ApiProperty({ example: 'Chapli Kabab (Plate of 3)' }) description!: string;
  @ApiProperty({ example: 1 }) quantity!: number;
  @ApiProperty({ example: 700 }) unitPrice!: number;
  @ApiProperty({ example: 760 }) amount!: number;
}

export class InvoiceDto {
  @ApiProperty({ example: 'ZD-260804-0001' }) invoiceNumber!: string;
  @ApiProperty() issuedAt!: Date;
  @ApiProperty({ example: 'Ahmad Khan' }) customerName!: string;
  @ApiProperty({ example: '+923001234567' }) customerPhone!: string;
  @ApiProperty({ example: 'House 14, Street 3, Gulshan Colony' }) deliveryAddress!: string;
  @ApiProperty({ example: 'Chapli Kabab House' }) restaurantName!: string;
  @ApiProperty({ example: 'Main GT Road, Pabbi' }) restaurantAddress!: string;
  @ApiProperty({ type: [InvoiceLineDto] }) lines!: InvoiceLineDto[];
  @ApiProperty({ type: OrderTotalsDto }) totals!: OrderTotalsDto;
  @ApiProperty({ enum: PaymentMethod }) paymentMethod!: PaymentMethod;
  @ApiProperty({ enum: PaymentStatus }) paymentStatus!: PaymentStatus;
  @ApiProperty({ example: 0, description: 'Total already refunded against this order.' })
  refundedAmount!: number;
  @ApiPropertyOptional({ nullable: true }) couponCode!: string | null;
}

// ── Mappers ────────────────────────────────────────────────────

function toParty(
  entity: { id: string; name: string; phone?: string | null } | null,
): OrderPartyDto | null {
  return entity === null ? null : { id: entity.id, name: entity.name, phone: entity.phone ?? null };
}

export interface OrderDtoOptions {
  /** Transitions available to the caller, given their role. */
  allowedTransitions?: OrderStatus[];
  canCancel?: boolean;
  includeTransactions?: boolean;
}

export function toOrderDto(order: OrderWithDetails, options: OrderDtoOptions = {}): OrderDto {
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    statusText: OrderStateMachine.describe(order.status),
    type: order.type,
    restaurant: {
      id: order.restaurant.id,
      name: order.restaurant.name,
      phone: order.restaurant.phone,
    },
    driver: toParty(
      order.driver === null
        ? null
        : {
            id: order.driver.id,
            name: order.driver.user.fullName,
            phone: order.driver.user.phone,
          },
    ),
    items: order.items.map((line) => ({
      id: line.id,
      menuItemId: line.menuItemId,
      name: line.nameSnapshot,
      variantName: line.variantNameSnapshot,
      unitPrice: Number(line.unitPrice),
      quantity: line.quantity,
      lineTotal: Number(line.lineTotal),
      notes: line.notes,
      addOns: line.addOns.map((addOn) => ({
        name: addOn.nameSnapshot,
        price: Number(addOn.price),
        quantity: addOn.quantity,
      })),
    })),
    totals: {
      subtotal: Number(order.subtotal),
      discountAmount: Number(order.discountAmount),
      deliveryFee: Number(order.deliveryFee),
      serviceFee: Number(order.serviceFee),
      taxAmount: Number(order.taxAmount),
      tipAmount: Number(order.tipAmount),
      totalAmount: Number(order.totalAmount),
      currency: order.currency,
    },
    paymentMethod: order.paymentMethod,
    paymentStatus: order.paymentStatus,
    couponCode: order.couponCode,
    deliveryAddress: order.deliveryLine1 ?? '',
    deliveryLandmark: order.deliveryLandmark,
    deliveryNotes: order.deliveryNotes,
    distanceKm: order.distanceKm === null ? null : Number(order.distanceKm),
    estimatedDeliveryAt: order.estimatedDeliveryAt,
    placedAt: order.placedAt,
    deliveredAt: order.deliveredAt,
    cancelledAt: order.cancelledAt,
    cancelledBy: order.cancelledBy,
    cancellationReason: order.cancellationReason,
    allowedTransitions: options.allowedTransitions ?? [],
    canCancel: options.canCancel ?? false,
    // The trail is append-only, so ordering by time gives the true sequence.
    timeline: [...order.statusHistory]
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map((entry) => ({
        fromStatus: entry.fromStatus,
        toStatus: entry.toStatus,
        actor: entry.actor,
        label: OrderStateMachine.describe(entry.toStatus),
        note: entry.note,
        at: entry.createdAt,
      })),
    ...(options.includeTransactions === true && {
      transactions: order.transactions.map((entry) => ({
        id: entry.id,
        type: entry.type,
        status: entry.status,
        amount: Number(entry.amount),
        reference: entry.reference,
        description: entry.description,
        createdAt: entry.createdAt,
      })),
    }),
    createdAt: order.createdAt,
  };
}

export function toInvoiceDto(order: OrderWithDetails, refundedAmount: number): InvoiceDto {
  return {
    // The order number doubles as the invoice number: one reference for the
    // customer, the kitchen and support to quote.
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
      totalAmount: Number(order.totalAmount),
      currency: order.currency,
    },
    paymentMethod: order.paymentMethod,
    paymentStatus: order.paymentStatus,
    refundedAmount,
    couponCode: order.couponCode,
  };
}
