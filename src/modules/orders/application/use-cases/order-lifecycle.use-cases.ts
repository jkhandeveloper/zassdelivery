import { Injectable } from '@nestjs/common';
import { ActorType, OrderStatus, PaymentStatus, UserRole } from '@prisma/client';

import {
  BusinessRuleViolationException,
  ForbiddenOperationException,
  ResourceNotFoundException,
} from '@/common/exceptions/domain.exception';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import type { PaginatedResult } from '@/common/interfaces/paginated-result.interface';
import { buildOrderBy } from '@/common/utils/pagination.util';
import { DeliveryPricingRepository } from '@/modules/carts/domain/repositories/cart.repository';
import { RestaurantRepository } from '@/modules/restaurants/domain/repositories/restaurant.repository';

import { RealtimeService } from '@/modules/realtime/application/realtime.service';

import { OrderRepository, type OrderWithDetails } from '../../domain/repositories/order.repository';
import { OrderStateMachine, REFUNDABLE_STATUSES } from '../../domain/services/order-state-machine';
import {
  toInvoiceDto,
  toOrderDto,
  type InvoiceDto,
  type OrderDto,
} from '../dto/order-response.dto';
import { ORDER_SORT_FIELDS, type ListOrdersAdminQueryDto } from '../dto/order.dto';

const SETTING_CANCEL_WINDOW = 'orders.cancellation_window_minutes';

/**
 * Statuses reached before the kitchen commits ingredients. Stock taken at
 * checkout is returned only from these — once cooking has started the
 * ingredients are gone, and restocking would overstate what is available.
 */
const UNCOMMITTED_STATUSES: OrderStatus[] = [
  OrderStatus.PENDING_PAYMENT,
  OrderStatus.PLACED,
  OrderStatus.CONFIRMED,
];

/** Statuses an order passes through while it is still in flight. */
const ACTIVE_STATUSES: OrderStatus[] = [
  OrderStatus.PENDING_PAYMENT,
  OrderStatus.PLACED,
  OrderStatus.CONFIRMED,
  OrderStatus.PREPARING,
  OrderStatus.READY_FOR_PICKUP,
  OrderStatus.PICKED_UP,
  OrderStatus.ON_THE_WAY,
];

/**
 * Resolves which party the caller is acting as for a given order.
 *
 * The same endpoint serves customers, restaurants, riders and staff, and the
 * state machine decides what each may do — so establishing the actor correctly
 * is what stops a customer marking their own order delivered.
 */
@Injectable()
export class OrderAccessService {
  constructor(
    private readonly orders: OrderRepository,
    private readonly restaurants: RestaurantRepository,
  ) {}

  async load(orderId: string): Promise<OrderWithDetails> {
    const order = await this.orders.findById(orderId);

    if (!order) {
      throw new ResourceNotFoundException('Order', orderId);
    }

    return order;
  }

  /** The order, plus the role the caller holds over it. */
  async loadFor(
    orderId: string,
    actor: AuthenticatedUser,
  ): Promise<{ order: OrderWithDetails; as: ActorType }> {
    const order = await this.load(orderId);
    const as = await this.actorFor(order, actor);

    return { order, as };
  }

  async actorFor(order: OrderWithDetails, actor: AuthenticatedUser): Promise<ActorType> {
    if (actor.role === UserRole.ADMIN || actor.role === UserRole.SUPER_ADMIN) {
      return ActorType.ADMIN;
    }

    if (order.customerId === actor.id) {
      return ActorType.CUSTOMER;
    }

    // The rider assigned to this delivery, matched on the user behind the
    // driver profile rather than merely on the role — any rider would otherwise
    // be able to progress anyone's delivery.
    if (order.driver !== null && order.driver.userId === actor.id) {
      return ActorType.DRIVER;
    }

    if (actor.role === UserRole.VENDOR_OWNER || actor.role === UserRole.VENDOR_STAFF) {
      const restaurant = await this.restaurants.findById(order.restaurantId, true);

      if (restaurant && restaurant.ownerId === actor.id) {
        return ActorType.RESTAURANT;
      }
    }

    // 404 rather than 403 for an order that is none of the caller's business:
    // confirming the id exists would itself be a disclosure.
    throw new ResourceNotFoundException('Order', order.id);
  }
}

@Injectable()
export class ListOrdersUseCase {
  constructor(private readonly orders: OrderRepository) {}

  async execute(
    query: ListOrdersAdminQueryDto,
    scope: { customerId?: string; restaurantId?: string; driverId?: string } = {},
  ): Promise<PaginatedResult<OrderDto>> {
    const orderBy = buildOrderBy(query.sortBy, query.sortOrder, ORDER_SORT_FIELDS, 'createdAt');

    const result = await this.orders.findMany({
      page: query.page,
      limit: query.limit,
      orderBy,
      // The caller-supplied scope always wins over anything in the query
      // string, so a customer cannot list another customer's orders by
      // passing customerId.
      customerId: scope.customerId ?? query.customerId,
      restaurantId: scope.restaurantId ?? query.restaurantId,
      driverId: scope.driverId ?? query.driverId,
      status: query.status,
      activeOnly: query.activeOnly,
      from: query.from,
      to: query.to,
      search: query.search,
    });

    return {
      items: result.items.map((order) => toOrderDto(order)),
      meta: result.meta,
    };
  }
}

@Injectable()
export class GetOrderUseCase {
  constructor(
    private readonly access: OrderAccessService,
    private readonly settings: DeliveryPricingRepository,
  ) {}

  async execute(orderId: string, actor: AuthenticatedUser): Promise<OrderDto> {
    const { order, as } = await this.access.loadFor(orderId, actor);
    const windowMinutes = await this.settings.numericSetting(SETTING_CANCEL_WINDOW, 5);

    // The transitions offered are filtered by what this caller may actually do,
    // so a client can render its action buttons straight from the response.
    const allowed = OrderStateMachine.allowedFrom(order.status)
      .filter((rule) => rule.actors.includes(as))
      .map((rule) => rule.to);

    const cancellable =
      as === ActorType.CUSTOMER
        ? OrderStateMachine.customerMayCancel(order.status, order.placedAt, windowMinutes)
        : { allowed: allowed.includes(OrderStatus.CANCELLED) };

    return toOrderDto(order, {
      allowedTransitions: allowed,
      canCancel: cancellable.allowed,
      // Money movements are visible to the customer who paid and to staff, but
      // not to the kitchen or the rider.
      includeTransactions: as === ActorType.CUSTOMER || as === ActorType.ADMIN,
    });
  }
}

@Injectable()
export class AdvanceOrderUseCase {
  constructor(
    private readonly orders: OrderRepository,
    private readonly access: OrderAccessService,
    private readonly realtime: RealtimeService,
  ) {}

  /**
   * The single entry point for every lifecycle move: accept, reject, start
   * preparing, ready, pick up, on the way, delivered, cancel.
   *
   * Routing them all through the state machine means a new endpoint cannot
   * accidentally introduce an illegal path.
   */
  async execute(
    orderId: string,
    to: OrderStatus,
    actor: AuthenticatedUser,
    options: {
      note?: string | null;
      reason?: string | null;
      /**
       * Set by the rider module once the customer's delivery code has been
       * checked. Nothing else may set it.
       */
      otpVerified?: boolean;
    } = {},
  ): Promise<OrderDto> {
    const { order, as } = await this.access.loadFor(orderId, actor);

    OrderStateMachine.assertTransition(order.status, to, as);

    if (to === OrderStatus.REJECTED && !options.reason) {
      throw new BusinessRuleViolationException('A rejection must include a reason.');
    }

    // A rider closes a delivery against the code the customer was given, never
    // on their own say-so. Enforced here rather than on the rider route because
    // this is the one path every lifecycle move goes through — a rider who
    // found this generic endpoint would otherwise walk straight around it.
    if (to === OrderStatus.DELIVERED && as === ActorType.DRIVER && options.otpVerified !== true) {
      throw new ForbiddenOperationException(
        'Confirm this delivery with the customer’s code through the rider app.',
      );
    }

    // Stock is returned only when the kitchen never committed it. Once cooking
    // has started the ingredients are gone, so restocking would overstate what
    // is actually available.
    const restock = REFUNDABLE_STATUSES.includes(to) && UNCOMMITTED_STATUSES.includes(order.status);

    const updated = await this.orders.transition(orderId, to, {
      actor: as,
      actorUserId: actor.id,
      note: options.note ?? null,
      cancellationReason: options.reason ?? null,
      restock,
    });

    // Announced after the transaction, never inside it: a customer's phone
    // being unreachable must not roll back an order the kitchen has accepted.
    this.announce(updated, as);

    return toOrderDto(updated, { includeTransactions: as === ActorType.ADMIN });
  }

  /**
   * Pushes the transition to everyone watching.
   *
   * Two audiences, two rooms: the customer following their order, and the
   * kitchen whose board the ticket sits on. Both are fire-and-forget — the
   * state is already committed, and a websocket is a convenience on top of it.
   */
  private announce(order: OrderWithDetails, actor: ActorType): void {
    this.realtime.orderStatusChanged({
      orderId: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      statusText: OrderStateMachine.describe(order.status),
      actor,
      at: new Date().toISOString(),
    });

    this.realtime.restaurantOrderUpdated(order.restaurantId, {
      orderId: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      totalAmount: Number(order.totalAmount),
      itemCount: order.items.length,
      customerName: order.customer.fullName,
      placedAt: order.placedAt?.toISOString() ?? null,
    });
  }
}

@Injectable()
export class CancelOrderUseCase {
  constructor(
    private readonly orders: OrderRepository,
    private readonly access: OrderAccessService,
    private readonly settings: DeliveryPricingRepository,
    private readonly realtime: RealtimeService,
  ) {}

  async execute(
    orderId: string,
    actor: AuthenticatedUser,
    reason: string | undefined,
  ): Promise<OrderDto> {
    const { order, as } = await this.access.loadFor(orderId, actor);

    if (as === ActorType.CUSTOMER) {
      const windowMinutes = await this.settings.numericSetting(SETTING_CANCEL_WINDOW, 5);
      const verdict = OrderStateMachine.customerMayCancel(
        order.status,
        order.placedAt,
        windowMinutes,
      );

      if (!verdict.allowed) {
        throw new ForbiddenOperationException(verdict.reason ?? 'This order cannot be cancelled.');
      }
    }

    OrderStateMachine.assertTransition(order.status, OrderStatus.CANCELLED, as);

    const restock = UNCOMMITTED_STATUSES.includes(order.status);

    const updated = await this.orders.transition(orderId, OrderStatus.CANCELLED, {
      actor: as,
      actorUserId: actor.id,
      cancellationReason: reason ?? 'Cancelled by ' + as.toLowerCase(),
      restock,
    });

    this.realtime.orderStatusChanged({
      orderId: updated.id,
      orderNumber: updated.orderNumber,
      status: updated.status,
      statusText: OrderStateMachine.describe(updated.status),
      actor: as,
      at: new Date().toISOString(),
    });

    this.realtime.restaurantOrderUpdated(updated.restaurantId, {
      orderId: updated.id,
      orderNumber: updated.orderNumber,
      status: updated.status,
      totalAmount: Number(updated.totalAmount),
      itemCount: updated.items.length,
      customerName: updated.customer.fullName,
      placedAt: updated.placedAt?.toISOString() ?? null,
    });

    return toOrderDto(updated, { includeTransactions: true });
  }
}

@Injectable()
export class RefundOrderUseCase {
  constructor(
    private readonly orders: OrderRepository,
    private readonly access: OrderAccessService,
  ) {}

  /**
   * Returns money to the customer's wallet and posts the ledger entry.
   *
   * Refunds are additive rather than a status change: an order that was
   * delivered stays delivered, and the correction lives in the transaction
   * trail where it can be audited.
   */
  async execute(
    orderId: string,
    actor: AuthenticatedUser,
    amount: number | undefined,
    reason: string,
  ): Promise<{ message: string; refunded: number; totalRefunded: number }> {
    const order = await this.access.load(orderId);

    if (actor.role !== UserRole.ADMIN && actor.role !== UserRole.SUPER_ADMIN) {
      throw new ForbiddenOperationException('Only staff may issue refunds.');
    }

    // PARTIALLY_REFUNDED must stay refundable, or the remainder of a partial
    // refund could never be returned. Only an order that was never paid — or
    // one already refunded in full — has nothing left to give back.
    const refundableStatuses: PaymentStatus[] = [
      PaymentStatus.PAID,
      PaymentStatus.PARTIALLY_REFUNDED,
    ];

    if (!refundableStatuses.includes(order.paymentStatus)) {
      throw new BusinessRuleViolationException(
        order.paymentStatus === PaymentStatus.REFUNDED
          ? 'This order has already been fully refunded.'
          : 'This order has not been paid, so there is nothing to refund.',
      );
    }

    const alreadyRefunded = await this.orders.totalRefunded(orderId);
    const refundable = Number(order.totalAmount) - alreadyRefunded;

    if (refundable <= 0) {
      throw new BusinessRuleViolationException('This order has already been fully refunded.');
    }

    const requested = amount ?? refundable;

    // Refunding more than was paid would create money; the ledger must balance.
    if (requested > refundable) {
      throw new BusinessRuleViolationException(
        `At most Rs. ${refundable} can still be refunded on this order.`,
      );
    }

    const successfulPayment = order.payments.find(
      (payment) => payment.status === PaymentStatus.PAID,
    );

    await this.orders.refund({
      orderId,
      paymentId: successfulPayment?.id ?? null,
      userId: order.customerId,
      amount: requested,
      reason,
      actorId: actor.id,
    });

    const totalRefunded = alreadyRefunded + requested;

    return {
      message: `Rs. ${requested} refunded to the customer's wallet.`,
      refunded: requested,
      totalRefunded,
    };
  }
}

@Injectable()
export class OrderTimelineUseCase {
  constructor(private readonly access: OrderAccessService) {}

  async execute(orderId: string, actor: AuthenticatedUser) {
    const { order } = await this.access.loadFor(orderId, actor);

    return [...order.statusHistory]
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map((entry) => ({
        fromStatus: entry.fromStatus,
        toStatus: entry.toStatus,
        actor: entry.actor,
        label: OrderStateMachine.describe(entry.toStatus),
        note: entry.note,
        at: entry.createdAt,
      }));
  }
}

@Injectable()
export class OrderTransactionsUseCase {
  constructor(
    private readonly orders: OrderRepository,
    private readonly access: OrderAccessService,
  ) {}

  async execute(orderId: string, actor: AuthenticatedUser) {
    const { as } = await this.access.loadFor(orderId, actor);

    // The kitchen and the rider have no business seeing the money trail.
    if (as !== ActorType.CUSTOMER && as !== ActorType.ADMIN) {
      throw new ForbiddenOperationException('You cannot view this order’s transactions.');
    }

    const entries = await this.orders.transactionsFor(orderId);

    return entries.map((entry) => ({
      id: entry.id,
      type: entry.type,
      status: entry.status,
      amount: Number(entry.amount),
      reference: entry.reference,
      description: entry.description,
      createdAt: entry.createdAt,
    }));
  }
}

@Injectable()
export class OrderInvoiceUseCase {
  constructor(
    private readonly orders: OrderRepository,
    private readonly access: OrderAccessService,
  ) {}

  async execute(orderId: string, actor: AuthenticatedUser): Promise<InvoiceDto> {
    const { order, as } = await this.access.loadFor(orderId, actor);

    if (as === ActorType.DRIVER) {
      throw new ForbiddenOperationException('Riders cannot access customer invoices.');
    }

    // An invoice for an order nobody has paid for would be misleading, so it is
    // only issued once the order is actually settled.
    if (order.status === OrderStatus.PENDING_PAYMENT) {
      throw new BusinessRuleViolationException(
        'An invoice is available once the order has been placed.',
      );
    }

    const refunded = await this.orders.totalRefunded(orderId);

    return toInvoiceDto(order, refunded);
  }
}

export { ACTIVE_STATUSES };
