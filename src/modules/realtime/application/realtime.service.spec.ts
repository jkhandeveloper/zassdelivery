import { ActorType, OrderStatus } from '@prisma/client';
import type { LoggerService } from '@nestjs/common';
import type { Server } from 'socket.io';

import { ServerEvents } from '../domain/events';
import { RealtimeService } from './realtime.service';

const logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() } as unknown as LoggerService;

function build(options: { emitThrows?: boolean; sockets?: unknown[] } = {}) {
  const emit =
    options.emitThrows === true
      ? jest.fn(() => {
          throw new Error('transport closed');
        })
      : jest.fn();

  const to = jest.fn().mockReturnValue({ emit });
  const server = {
    to,
    in: jest
      .fn()
      .mockReturnValue({ fetchSockets: jest.fn().mockResolvedValue(options.sockets ?? []) }),
    fetchSockets: jest.fn().mockResolvedValue(options.sockets ?? []),
  } as unknown as Server;

  const service = new RealtimeService(logger);
  service.bind(server);

  return { service, server, to, emit };
}

const STATUS = {
  orderId: 'order-1',
  orderNumber: 'ZD-260810-0007',
  status: OrderStatus.ON_THE_WAY,
  statusText: 'On the way to you',
  actor: ActorType.DRIVER,
  at: '2026-08-10T12:00:00.000Z',
};

describe('RealtimeService before the gateway starts', () => {
  it('reports itself as not live', () => {
    expect(new RealtimeService(logger).isLive).toBe(false);
  });

  it('swallows a publish rather than crashing during boot', () => {
    const service = new RealtimeService(logger);

    expect(() => service.orderStatusChanged(STATUS)).not.toThrow();
  });

  it('reports zero connections', async () => {
    await expect(new RealtimeService(logger).connectionCount()).resolves.toBe(0);
  });
});

describe('RealtimeService.orderStatusChanged', () => {
  it('emits to that order’s room and nowhere else', () => {
    const { service, to, emit } = build();

    service.orderStatusChanged(STATUS);

    expect(to).toHaveBeenCalledWith('order:order-1');
    expect(to).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith(ServerEvents.orderStatus, STATUS);
  });
});

describe('RealtimeService.riderMoved', () => {
  const position = {
    orderId: 'order-1',
    driverId: 'rider-1',
    latitude: 34.0151,
    longitude: 71.7938,
    distanceKm: 1.2,
    at: '2026-08-10T12:00:00.000Z',
  };

  it('reaches the customer watching the order and the dispatch board', () => {
    const { service, to } = build();

    service.riderMoved(position);

    expect(to).toHaveBeenCalledWith('order:order-1');
    expect(to).toHaveBeenCalledWith('dispatch');
  });

  it('still reaches dispatch when the rider is between deliveries', () => {
    const { service, to } = build();

    service.riderMoved({ ...position, orderId: null });

    expect(to).toHaveBeenCalledTimes(1);
    expect(to).toHaveBeenCalledWith('dispatch');
  });
});

describe('RealtimeService.deliveryOffered', () => {
  it('goes to that rider alone, and to the board', () => {
    const { service, to } = build();

    service.deliveryOffered('rider-7', {
      assignmentId: 'assignment-1',
      orderId: 'order-1',
      orderNumber: 'ZD-260810-0007',
      restaurantName: 'Chapli Kabab House',
      estimatedEarning: 105,
      pickupDistanceKm: 0.8,
      expiresAt: '2026-08-10T12:01:00.000Z',
    });

    expect(to).toHaveBeenCalledWith('rider:rider-7');
    expect(to).toHaveBeenCalledWith('dispatch');
    expect(to).toHaveBeenCalledTimes(2);
  });
});

describe('RealtimeService.notificationCreated', () => {
  it('goes to that user’s personal room', () => {
    const { service, to, emit } = build();

    service.notificationCreated('user-1', {
      id: 'notification-1',
      type: 'ORDER_UPDATE',
      title: 'Your order is on the way',
      body: 'Bilal is 5 minutes away.',
      data: null,
      createdAt: '2026-08-10T12:00:00.000Z',
    });

    expect(to).toHaveBeenCalledWith('user:user-1');
    expect(emit).toHaveBeenCalledWith(ServerEvents.notification, expect.anything());
  });
});

describe('RealtimeService when the transport misbehaves', () => {
  it('never lets a broadcast failure reach the caller', () => {
    const { service } = build({ emitThrows: true });

    // The order is already committed; failing it because a socket died would
    // trade a missed update for a lost order.
    expect(() => service.orderStatusChanged(STATUS)).not.toThrow();
    expect(logger.warn).toHaveBeenCalled();
  });
});

describe('RealtimeService presence', () => {
  it('counts sockets across every instance', async () => {
    const { service } = build({ sockets: [{}, {}, {}] });

    await expect(service.connectionCount()).resolves.toBe(3);
  });

  it('counts one room', async () => {
    const { service } = build({ sockets: [{}, {}] });

    await expect(service.roomSize('dispatch')).resolves.toBe(2);
  });
});
