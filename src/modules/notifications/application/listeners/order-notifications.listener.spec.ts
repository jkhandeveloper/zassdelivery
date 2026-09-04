import type { LoggerService } from '@nestjs/common';
import { ActorType, NotificationChannel, OrderStatus } from '@prisma/client';

import type { OrderStatusEventPayload } from '@/modules/orders/domain/events/order.events';

import type { NotifyService } from '../use-cases/notify.service';
import { OrderNotificationsListener } from './order-notifications.listener';

const logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() } as unknown as LoggerService;

function event(overrides: Partial<OrderStatusEventPayload> = {}): OrderStatusEventPayload {
  return {
    orderId: 'order-1',
    orderNumber: 'ZD-1001',
    status: OrderStatus.PLACED,
    statusText: 'Sent to the restaurant',
    previousStatus: null,
    actor: null,
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

function build() {
  const notify = {
    notify: jest.fn().mockResolvedValue({ notificationId: 'n1', channels: [] }),
  } as unknown as jest.Mocked<NotifyService>;

  return { notify, listener: new OrderNotificationsListener(notify, logger) };
}

/** Who a batch of sends was addressed to, in order. */
function recipients(notify: jest.Mocked<NotifyService>): string[] {
  return (notify.notify as jest.Mock).mock.calls.map(
    (call) => (call[0] as { userId: string }).userId,
  );
}

beforeEach(() => jest.clearAllMocks());

describe('OrderNotificationsListener — a new order', () => {
  it('tells the customer and the restaurant', async () => {
    const { listener, notify } = build();

    await listener.onPlaced(event());

    expect(recipients(notify)).toEqual(['customer-1', 'vendor-1']);
  });

  it('pushes to the vendor, whose acceptance the customer is waiting on', async () => {
    const { listener, notify } = build();

    await listener.onPlaced(event());

    const vendorSend = (notify.notify as jest.Mock).mock.calls[1]?.[0] as {
      channels?: NotificationChannel[];
    };

    expect(vendorSend.channels).toContain(NotificationChannel.PUSH);
  });

  it('carries the order id, so opening the notification can go straight to it', async () => {
    const { listener, notify } = build();

    await listener.onPlaced(event());

    const sent = (notify.notify as jest.Mock).mock.calls[0]?.[0] as {
      data: Record<string, unknown>;
    };

    expect(sent.data).toMatchObject({ orderId: 'order-1', orderNumber: 'ZD-1001' });
  });
});

describe('OrderNotificationsListener — transitions', () => {
  it('tells the customer when the restaurant accepts', async () => {
    const { listener, notify } = build();

    await listener.onStatusChanged(event({ status: OrderStatus.CONFIRMED }));

    expect(recipients(notify)).toEqual(['customer-1']);
  });

  it('stays quiet on the statuses the riders module already covers', async () => {
    const { listener, notify } = build();

    for (const status of [OrderStatus.PREPARING, OrderStatus.PICKED_UP]) {
      await listener.onStatusChanged(event({ status }));
    }

    // A second message saying what the delivery code and the rider's name have
    // already said is how a notification list becomes something people mute.
    expect(notify.notify).not.toHaveBeenCalled();
  });

  it('tells the customer when the rider sets off, and pushes it', async () => {
    const { listener, notify } = build();

    await listener.onStatusChanged(event({ status: OrderStatus.ON_THE_WAY }));

    // The one moment the customer has no other way to learn about: the map
    // starts moving, and nothing else announces it.
    expect(recipients(notify)).toEqual(['customer-1']);
    expect(notify.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        channels: [NotificationChannel.IN_APP, NotificationChannel.PUSH],
      }),
    );
  });

  it('tells everyone still holding a cancelled order, including the rider', async () => {
    const { listener, notify } = build();

    await listener.onStatusChanged(
      event({ status: OrderStatus.CANCELLED, driverUserId: 'rider-user-1' }),
    );

    expect(recipients(notify)).toEqual(['customer-1', 'vendor-1', 'rider-user-1']);
  });

  it('leaves the rider out of a cancellation when nobody had accepted it', async () => {
    const { listener, notify } = build();

    await listener.onStatusChanged(event({ status: OrderStatus.CANCELLED, driverUserId: null }));

    expect(recipients(notify)).toEqual(['customer-1', 'vendor-1']);
  });

  it('tells only the customer when the restaurant rejects', async () => {
    const { listener, notify } = build();

    await listener.onStatusChanged(
      event({ status: OrderStatus.REJECTED, actor: ActorType.RESTAURANT }),
    );

    expect(recipients(notify)).toEqual(['customer-1']);
  });
});

describe('OrderNotificationsListener — failures', () => {
  it('still reaches the others when one recipient cannot be notified', async () => {
    const { listener, notify } = build();

    (notify.notify as jest.Mock).mockRejectedValueOnce(new Error('no such user'));

    await expect(listener.onPlaced(event())).resolves.toBeUndefined();
    expect(notify.notify).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalled();
  });

  it('never throws back at the order that has already been committed', async () => {
    const { listener, notify } = build();

    (notify.notify as jest.Mock).mockRejectedValue(new Error('notifications are down'));

    await expect(
      listener.onStatusChanged(event({ status: OrderStatus.DELIVERED })),
    ).resolves.toBeUndefined();
  });
});
