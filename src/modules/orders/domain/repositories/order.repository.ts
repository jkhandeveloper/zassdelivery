import type {
  ActorType,
  Address,
  Order,
  OrderItem,
  OrderItemAddOn,
  OrderStatus,
  OrderStatusHistory,
  Payment,
  PaymentMethod,
  PaymentStatus,
  Prisma,
  Restaurant,
  Transaction,
  User,
} from '@prisma/client';

import type { PaginatedResult } from '@/common/interfaces/paginated-result.interface';

export type OrderWithDetails = Order & {
  // Coordinates travel with the order because dispatch ranks riders by how far
  // they are from the kitchen, and re-reading the restaurant to find that out
  // would be a second query on the hottest path in the module.
  restaurant: Pick<
    Restaurant,
    'id' | 'name' | 'slug' | 'logoUrl' | 'phone' | 'addressLine' | 'latitude' | 'longitude'
  >;
  customer: Pick<User, 'id' | 'fullName' | 'phone'>;
  driver: { id: string; userId: string; user: Pick<User, 'fullName' | 'phone'> } | null;
  address: Address | null;
  items: Array<OrderItem & { addOns: OrderItemAddOn[] }>;
  statusHistory: OrderStatusHistory[];
  payments: Payment[];
  transactions: Transaction[];
};

export interface ListOrdersFilter {
  page: number;
  limit: number;
  orderBy: Prisma.OrderOrderByWithRelationInput;
  customerId?: string;
  restaurantId?: string;
  driverId?: string;
  status?: OrderStatus;
  /** Settlement state, for the invoice and reconciliation views. */
  paymentStatus?: PaymentStatus;
  /** Convenience filter for the "active orders" dashboards. */
  activeOnly?: boolean;
  from?: Date;
  to?: Date;
  search?: string;
}

/** Everything needed to write an order, already priced and validated. */
export interface PlaceOrderInput {
  customerId: string;
  restaurantId: string;
  zoneId: string;
  addressId: string;
  delivery: {
    line1: string;
    landmark: string | null;
    latitude: number;
    longitude: number;
    recipientName: string;
    recipientPhone: string;
    notes: string | null;
  };
  totals: {
    subtotal: number;
    discountAmount: number;
    deliveryFee: number;
    serviceFee: number;
    taxAmount: number;
    tipAmount: number;
    totalAmount: number;
  };
  couponId: string | null;
  couponCode: string | null;
  paymentMethod: PaymentMethod;
  distanceKm: number | null;
  preparationMinutes: number;
  estimatedDeliveryAt: Date;
  customerNote: string | null;
  lines: Array<{
    menuItemId: string;
    variantId: string | null;
    nameSnapshot: string;
    variantNameSnapshot: string | null;
    unitPrice: number;
    quantity: number;
    lineTotal: number;
    notes: string | null;
    /** Stock is decremented for these when the dish tracks inventory. */
    tracksInventory: boolean;
    addOns: Array<{ addOnId: string; nameSnapshot: string; price: number; quantity: number }>;
  }>;
}

export interface RefundInput {
  orderId: string;
  paymentId: string | null;
  userId: string;
  amount: number;
  reason: string;
  actorId: string;
}

export abstract class OrderRepository {
  abstract findMany(filter: ListOrdersFilter): Promise<PaginatedResult<OrderWithDetails>>;
  abstract findById(id: string): Promise<OrderWithDetails | null>;
  abstract findByNumber(orderNumber: string): Promise<OrderWithDetails | null>;

  /**
   * Writes the order and everything that must happen with it — lines, add-ons,
   * the opening timeline entry, the payment row, stock decrements, coupon
   * accounting and clearing the cart — in one transaction.
   *
   * The platform commission is computed here from the restaurant's own rate,
   * read inside the transaction, so it can never be supplied by a caller.
   */
  abstract place(input: PlaceOrderInput, cartId: string): Promise<OrderWithDetails>;

  abstract transition(
    orderId: string,
    to: OrderStatus,
    context: {
      actor: ActorType;
      actorUserId: string | null;
      note?: string | null;
      /** Set when the move is a cancellation or rejection. */
      cancellationReason?: string | null;
      /** Returns reserved stock when the order ends before it was cooked. */
      restock: boolean;
    },
  ): Promise<OrderWithDetails>;

  abstract timeline(orderId: string): Promise<OrderStatusHistory[]>;
  abstract transactionsFor(orderId: string): Promise<Transaction[]>;

  /** Records a refund: ledger entry, payment update and wallet credit. */
  abstract refund(input: RefundInput): Promise<Transaction>;

  abstract totalRefunded(orderId: string): Promise<number>;
  abstract countForCustomer(customerId: string): Promise<number>;
}
