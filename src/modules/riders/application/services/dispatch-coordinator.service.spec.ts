import type { LoggerService } from '@nestjs/common';
import { ActorType, OrderStatus } from '@prisma/client';

import { BusinessRuleViolationException } from '@/common/exceptions/domain.exception';
import type { OrderStatusEventPayload } from '@/modules/orders/domain/events/order.events';

import type { AssignmentRepository } from '../../domain/repositories/assignment.repository';
import type { AssignOrderUseCase, ExpireOffersUseCase } from '../use-cases/dispatch.use-cases';
import { DispatchCoordinator } from './dispatch-coordinator.service';

const logger = {
  log: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
} as unknown as LoggerService;

function event(overrides: Partial<OrderStatusEventPayload> = {}): OrderStatusEventPayload {
  return {
    orderId: 'order-1',
    orderNumber: 'ZD-1001',
    status: OrderStatus.CONFIRMED,
    statusText: 'Accepted — preparing shortly',
    previousStatus: OrderStatus.PLACED,
    actor: ActorType.RESTAURANT,
    customerId: 'customer-1',
    restaurantId: 'restaurant-1',
    restaurantName: 'Kabul Grill',
    restaurantOwnerId: 'vendor-1',
    driverUserId: null,
    totalAmount: 1450,
    at: new Date().toISOString(),
    ...overrides,
  };
}

function build(options: { waiting?: string[]; expired?: number } = {}) {
  const assignments = {
    findOrderIdsAwaitingDispatch: jest.fn().mockResolvedValue(options.waiting ?? []),
    releaseForClosedOrder: jest.fn().mockResolvedValue(1),
  } as unknown as jest.Mocked<AssignmentRepository>;

  const assign = {
    execute: jest.fn().mockResolvedValue({ id: 'assignment-1', expiresAt: new Date() }),
  } as unknown as jest.Mocked<AssignOrderUseCase>;

  const expireOffers = {
    execute: jest.fn().mockResolvedValue({ expired: options.expired ?? 0 }),
  } as unknown as jest.Mocked<ExpireOffersUseCase>;

  return {
    assignments,
    assign,
    expireOffers,
    coordinator: new DispatchCoordinator(assignments, assign, expireOffers, logger),
  };
}

beforeEach(() => jest.clearAllMocks());

describe('DispatchCoordinator — the confirmation hook', () => {
  it('offers an order the moment the business confirms it', async () => {
    const { coordinator, assign } = build();

    await coordinator.onOrderConfirmed(event());

    expect(assign.execute).toHaveBeenCalledWith('order-1', {}, null);
  });

  it('ignores every status but CONFIRMED, so one order is not offered repeatedly', async () => {
    const { coordinator, assign } = build();

    for (const status of [
      OrderStatus.PLACED,
      OrderStatus.PREPARING,
      OrderStatus.READY_FOR_PICKUP,
      OrderStatus.DELIVERED,
      OrderStatus.CANCELLED,
    ]) {
      await coordinator.onOrderConfirmed(event({ status }));
    }

    expect(assign.execute).not.toHaveBeenCalled();
  });

  it('swallows "no rider available" — it is the normal state at a rush, not a failure', async () => {
    const { coordinator, assign } = build();

    (assign.execute as jest.Mock).mockRejectedValue(
      new BusinessRuleViolationException('No rider is available for this order right now.'),
    );

    await expect(coordinator.onOrderConfirmed(event())).resolves.toBeUndefined();
  });

  it('never lets an unexpected failure escape into the order that triggered it', async () => {
    const { coordinator, assign } = build();

    (assign.execute as jest.Mock).mockRejectedValue(new Error('the database went away'));

    await expect(coordinator.onOrderConfirmed(event())).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalled();
  });
});

describe('DispatchCoordinator — the sweep', () => {
  it('expires stale offers before looking for orders to place', async () => {
    const { coordinator, expireOffers, assignments } = build({ expired: 2 });

    await coordinator.sweep();

    expect(expireOffers.execute).toHaveBeenCalled();

    const [expiredAt] = (expireOffers.execute as jest.Mock).mock.invocationCallOrder;
    const [searchedAt] = (assignments.findOrderIdsAwaitingDispatch as jest.Mock).mock
      .invocationCallOrder;

    // Freeing the orders has to happen first, or the very orders this sweep
    // exists to re-offer still look like they have a live assignment.
    expect(expiredAt).toBeDefined();
    expect(searchedAt).toBeGreaterThan(expiredAt as number);
  });

  it('offers every order that is waiting', async () => {
    const { coordinator, assign } = build({ waiting: ['order-1', 'order-2', 'order-3'] });

    await coordinator.sweep();

    expect(assign.execute).toHaveBeenCalledTimes(3);
    expect((assign.execute as jest.Mock).mock.calls.map((call) => (call as [string])[0])).toEqual([
      'order-1',
      'order-2',
      'order-3',
    ]);
  });

  it('keeps going after one order cannot be placed', async () => {
    const { coordinator, assign } = build({ waiting: ['order-1', 'order-2'] });

    (assign.execute as jest.Mock)
      .mockRejectedValueOnce(new BusinessRuleViolationException('No rider is available.'))
      .mockResolvedValueOnce({ id: 'assignment-2', expiresAt: new Date() });

    await coordinator.sweep();

    expect(assign.execute).toHaveBeenCalledTimes(2);
  });

  it('does not run alongside itself when a sweep outlasts its interval', async () => {
    const { coordinator, expireOffers } = build({ waiting: ['order-1'] });

    let release = (): void => undefined;
    (expireOffers.execute as jest.Mock).mockReturnValue(
      new Promise((resolve) => {
        release = () => resolve({ expired: 0 });
      }),
    );

    const first = coordinator.sweep();
    await coordinator.sweep();

    // The second tick found the first still running and did nothing, so only
    // one pass has begun — otherwise the same order is offered to two riders.
    expect(expireOffers.execute).toHaveBeenCalledTimes(1);

    release();
    await first;
  });

  it('releases the guard after a failure, so one bad sweep does not stop dispatch forever', async () => {
    const { coordinator, expireOffers } = build();

    (expireOffers.execute as jest.Mock).mockRejectedValueOnce(new Error('redis timeout'));

    await coordinator.sweep();
    await coordinator.sweep();

    expect(expireOffers.execute).toHaveBeenCalledTimes(2);
  });
});

describe('DispatchCoordinator — an order closed by someone other than its rider', () => {
  it('releases the rider when the business marks the order delivered', async () => {
    const { coordinator, assignments } = build();

    await coordinator.onOrderClosed(
      event({ status: OrderStatus.DELIVERED, actor: ActorType.RESTAURANT }),
    );

    expect(assignments.releaseForClosedOrder).toHaveBeenCalledWith('order-1', expect.any(String));
  });

  it('releases the rider when the order is cancelled', async () => {
    const { coordinator, assignments } = build();

    await coordinator.onOrderClosed(
      event({ status: OrderStatus.CANCELLED, actor: ActorType.ADMIN }),
    );

    expect(assignments.releaseForClosedOrder).toHaveBeenCalledTimes(1);
  });

  it("leaves the rider's own confirmed delivery alone — that completes itself", async () => {
    const { coordinator, assignments } = build();

    await coordinator.onOrderClosed(
      event({ status: OrderStatus.DELIVERED, actor: ActorType.DRIVER }),
    );

    expect(assignments.releaseForClosedOrder).not.toHaveBeenCalled();
  });

  it('does nothing while the order is still moving', async () => {
    const { coordinator, assignments } = build();

    await coordinator.onOrderClosed(event({ status: OrderStatus.PREPARING }));

    expect(assignments.releaseForClosedOrder).not.toHaveBeenCalled();
  });
});
