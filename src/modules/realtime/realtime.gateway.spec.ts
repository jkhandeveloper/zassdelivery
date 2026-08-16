import { OrderStatus, UserRole } from '@prisma/client';
import type { LoggerService } from '@nestjs/common';
import type { Socket } from 'socket.io';

import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';

import type { RealtimeService } from './application/realtime.service';
import { ServerEvents } from './domain/events';
import type {
  OrderSnapshot,
  RealtimeAccessRepository,
} from './domain/repositories/realtime-access.repository';
import type { SocketAuthenticator } from './infrastructure/socket-authenticator';
import { RealtimeGateway } from './realtime.gateway';

const logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() } as unknown as LoggerService;

const CUSTOMER: AuthenticatedUser = {
  id: 'user-1',
  phone: '+923001234567',
  role: UserRole.CUSTOMER,
  permissions: [],
  staffRestaurantId: null,
  sessionId: 'session-1',
};

const ADMIN: AuthenticatedUser = { ...CUSTOMER, id: 'admin-1', role: UserRole.ADMIN };

function snapshot(overrides: Partial<OrderSnapshot> = {}): OrderSnapshot {
  return {
    id: 'order-1',
    orderNumber: 'ZD-260810-0007',
    status: OrderStatus.ON_THE_WAY,
    customerId: 'user-1',
    restaurantId: 'restaurant-1',
    restaurantName: 'Chapli Kabab House',
    driverId: 'rider-1',
    estimatedDeliveryAt: new Date('2026-08-10T12:30:00.000Z'),
    deliveryLat: 34.0091,
    deliveryLng: 71.7869,
    rider: { id: 'rider-1', name: 'Bilal Shah', phone: '+923009876543' },
    riderLocation: {
      latitude: 34.0151,
      longitude: 71.7938,
      at: new Date('2026-08-10T12:00:00.000Z'),
    },
    updatedAt: new Date('2026-08-10T12:00:00.000Z'),
    ...overrides,
  };
}

function fakeSocket(id = 'socket-1') {
  return {
    id,
    recovered: false,
    handshake: { auth: {}, headers: {}, query: {} },
    join: jest.fn().mockResolvedValue(undefined),
    leave: jest.fn().mockResolvedValue(undefined),
    emit: jest.fn(),
    disconnect: jest.fn(),
  } as unknown as Socket & { emit: jest.Mock; join: jest.Mock; disconnect: jest.Mock };
}

function build(
  options: {
    user?: AuthenticatedUser;
    authThrows?: string;
    driverId?: string | null;
    canAccessOrder?: boolean;
    canAccessRestaurant?: boolean;
    activeOrderId?: string | null;
    orderSnapshot?: OrderSnapshot | null;
  } = {},
) {
  const authenticator = {
    authenticate: options.authThrows
      ? jest.fn().mockRejectedValue(new Error(options.authThrows))
      : jest.fn().mockResolvedValue(options.user ?? CUSTOMER),
  } as unknown as jest.Mocked<SocketAuthenticator>;

  const access = {
    driverIdForUser: jest.fn().mockResolvedValue(options.driverId ?? null),
    canAccessOrder: jest.fn().mockResolvedValue(options.canAccessOrder ?? true),
    canAccessRestaurant: jest.fn().mockResolvedValue(options.canAccessRestaurant ?? true),
    activeOrderForDriver: jest.fn().mockResolvedValue(options.activeOrderId ?? 'order-1'),
    orderSnapshot: jest
      .fn()
      .mockResolvedValue('orderSnapshot' in options ? options.orderSnapshot : snapshot()),
    saveDriverLocation: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<RealtimeAccessRepository>;

  const realtime = {
    bind: jest.fn(),
    riderMoved: jest.fn(),
  } as unknown as jest.Mocked<RealtimeService>;

  return {
    authenticator,
    access,
    realtime,
    gateway: new RealtimeGateway(authenticator, access, realtime, logger),
  };
}

describe('RealtimeGateway — connection', () => {
  it('places a customer in their own room and announces readiness', async () => {
    const { gateway } = build();
    const socket = fakeSocket();

    await gateway.handleConnection(socket);

    expect(socket.join).toHaveBeenCalledWith(['user:user-1']);
    expect(socket.emit).toHaveBeenCalledWith(
      ServerEvents.ready,
      expect.objectContaining({ userId: 'user-1', rooms: ['user:user-1'], recovered: false }),
    );
  });

  it('puts a rider in their own channel, so an offer is not missed in the gap', async () => {
    const { gateway } = build({ driverId: 'rider-1' });
    const socket = fakeSocket();

    await gateway.handleConnection(socket);

    expect(socket.join).toHaveBeenCalledWith(['user:user-1', 'rider:rider-1']);
  });

  it('puts staff on the dispatch board', async () => {
    const { gateway } = build({ user: ADMIN });
    const socket = fakeSocket();

    await gateway.handleConnection(socket);

    expect(socket.join).toHaveBeenCalledWith(['user:admin-1', 'dispatch']);
  });

  it('closes a socket that cannot authenticate', async () => {
    const { gateway } = build({ authThrows: 'Authentication token is invalid or has expired.' });
    const socket = fakeSocket();

    await gateway.handleConnection(socket);

    expect(socket.emit).toHaveBeenCalledWith(
      ServerEvents.subscriptionError,
      expect.objectContaining({ room: 'connection' }),
    );
    // Left open, it would be used unauthenticated.
    expect(socket.disconnect).toHaveBeenCalledWith(true);
    expect(socket.join).not.toHaveBeenCalled();
  });
});

describe('RealtimeGateway — order subscriptions', () => {
  it('joins the room and answers with the current snapshot', async () => {
    const { gateway } = build();
    const socket = fakeSocket();
    await gateway.handleConnection(socket);

    const ack = await gateway.subscribeToOrder(socket, { orderId: 'order-1' });

    expect(ack).toMatchObject({ ok: true, room: 'order:order-1', error: null });
    expect(socket.join).toHaveBeenCalledWith('order:order-1');
    // Carried in the acknowledgement too: a callback-style client has not
    // attached its listener yet when the event fires, and would race it.
    expect(ack.snapshot).toMatchObject({ orderId: 'order-1' });
    // The snapshot is what lets a client that was offline resync without
    // reasoning about what it missed.
    expect(socket.emit).toHaveBeenCalledWith(
      ServerEvents.orderSnapshot,
      expect.objectContaining({ orderId: 'order-1', orderNumber: 'ZD-260810-0007' }),
    );
  });

  it('includes the rider’s last position, so a reconnecting map is not blank', async () => {
    const { gateway } = build();
    const socket = fakeSocket();
    await gateway.handleConnection(socket);

    await gateway.subscribeToOrder(socket, { orderId: 'order-1' });

    const emitted = socket.emit.mock.calls.find(
      ([event]) => event === ServerEvents.orderSnapshot,
    )?.[1] as { riderLocation: { latitude: number; distanceKm: number } };

    expect(emitted.riderLocation.latitude).toBe(34.0151);
    expect(emitted.riderLocation.distanceKm).toBeGreaterThan(0);
  });

  it('refuses an order that is not the caller’s', async () => {
    const { gateway } = build({ canAccessOrder: false });
    const socket = fakeSocket();
    await gateway.handleConnection(socket);

    const ack = await gateway.subscribeToOrder(socket, { orderId: 'someone-elses' });

    expect(ack.ok).toBe(false);
    expect(socket.join).not.toHaveBeenCalledWith('order:someone-elses');
    // The same answer as an order that does not exist: the difference would be
    // a way to discover which ids are real.
    expect(ack.error).toBe('That order is not available to you.');
  });

  it('refuses a subscribe with no orderId', async () => {
    const { gateway } = build();
    const socket = fakeSocket();
    await gateway.handleConnection(socket);

    await expect(gateway.subscribeToOrder(socket, {})).resolves.toMatchObject({ ok: false });
  });

  it('refuses a subscribe from a socket that never connected', async () => {
    const { gateway, access } = build();

    const ack = await gateway.subscribeToOrder(fakeSocket('unknown'), { orderId: 'order-1' });

    expect(ack.ok).toBe(false);
    expect(access.canAccessOrder).not.toHaveBeenCalled();
  });

  it('leaves the room on unsubscribe', async () => {
    const { gateway } = build();
    const socket = fakeSocket();
    await gateway.handleConnection(socket);

    await gateway.unsubscribeFromOrder(socket, { orderId: 'order-1' });

    expect(socket.leave).toHaveBeenCalledWith('order:order-1');
  });
});

describe('RealtimeGateway — restaurant subscriptions', () => {
  it('joins a kitchen the caller works at', async () => {
    const { gateway } = build();
    const socket = fakeSocket();
    await gateway.handleConnection(socket);

    const ack = await gateway.subscribeToRestaurant(socket, { restaurantId: 'restaurant-1' });

    expect(ack).toEqual({ ok: true, room: 'restaurant:restaurant-1', error: null });
  });

  it('refuses a kitchen the caller has nothing to do with', async () => {
    const { gateway } = build({ canAccessRestaurant: false });
    const socket = fakeSocket();
    await gateway.handleConnection(socket);

    const ack = await gateway.subscribeToRestaurant(socket, { restaurantId: 'somebody-elses' });

    expect(ack.ok).toBe(false);
    expect(socket.emit).toHaveBeenCalledWith(
      ServerEvents.subscriptionError,
      expect.objectContaining({ room: 'restaurant:somebody-elses' }),
    );
  });
});

describe('RealtimeGateway — rider tracking', () => {
  async function connectedRider() {
    const parts = build({ driverId: 'rider-1' });
    const socket = fakeSocket();
    await parts.gateway.handleConnection(socket);

    return { ...parts, socket };
  }

  it('broadcasts a position and attributes it to the rider’s own delivery', async () => {
    const { gateway, socket, realtime } = await connectedRider();

    const ack = await gateway.reportLocation(socket, { latitude: 34.02, longitude: 71.8 });

    expect(ack.ok).toBe(true);
    expect(realtime.riderMoved).toHaveBeenCalledWith(
      expect.objectContaining({ driverId: 'rider-1', orderId: 'order-1', latitude: 34.02 }),
    );
  });

  it('never takes the order from the payload', async () => {
    const { gateway, socket, realtime, access } = await connectedRider();

    await gateway.reportLocation(socket, {
      latitude: 34.02,
      longitude: 71.8,
      // A rider cannot put a position onto somebody else's order.
      orderId: 'someone-elses-order',
    } as { latitude: number; longitude: number });

    expect(access.activeOrderForDriver).toHaveBeenCalledWith('rider-1');
    expect(realtime.riderMoved).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: 'order-1' }),
    );
  });

  it('refuses a position from someone who is not a rider', async () => {
    const { gateway, realtime } = build({ driverId: null });
    const socket = fakeSocket();
    await gateway.handleConnection(socket);

    const ack = await gateway.reportLocation(socket, { latitude: 34.02, longitude: 71.8 });

    expect(ack.ok).toBe(false);
    expect(realtime.riderMoved).not.toHaveBeenCalled();
  });

  it('rejects coordinates that are not coordinates', async () => {
    const { gateway, socket, realtime } = await connectedRider();

    await expect(
      gateway.reportLocation(socket, { latitude: 999, longitude: 71.8 }),
    ).resolves.toMatchObject({ ok: false });
    await expect(
      gateway.reportLocation(socket, { latitude: 'north', longitude: 71.8 }),
    ).resolves.toMatchObject({ ok: false });
    expect(realtime.riderMoved).not.toHaveBeenCalled();
  });

  it('does not broadcast a rider who has not moved', async () => {
    const { gateway, socket, realtime } = await connectedRider();

    await gateway.reportLocation(socket, { latitude: 34.02, longitude: 71.8 });
    await gateway.reportLocation(socket, { latitude: 34.02, longitude: 71.8 });

    // A parked rider reporting every few seconds would otherwise fill a
    // customer's socket with a stationary dot.
    expect(realtime.riderMoved).toHaveBeenCalledTimes(1);
  });

  it('persists at most once per window, however often the phone reports', async () => {
    const { gateway, socket, access } = await connectedRider();

    await gateway.reportLocation(socket, { latitude: 34.02, longitude: 71.8 });
    await gateway.reportLocation(socket, { latitude: 34.03, longitude: 71.81 });
    await gateway.reportLocation(socket, { latitude: 34.04, longitude: 71.82 });

    expect(access.saveDriverLocation).toHaveBeenCalledTimes(1);
  });

  it('keeps broadcasting when the position cannot be written', async () => {
    const { gateway, socket, access, realtime } = await connectedRider();
    (access.saveDriverLocation as jest.Mock).mockRejectedValue(new Error('database busy'));

    const ack = await gateway.reportLocation(socket, { latitude: 34.02, longitude: 71.8 });

    // The live position already went out; a failed write costs the fallback.
    expect(realtime.riderMoved).toHaveBeenCalled();
    expect(ack.ok).toBe(true);
  });
});

describe('RealtimeGateway — housekeeping', () => {
  it('hands the server to the publish service on init', () => {
    const { gateway, realtime } = build();
    const server = {} as never;

    gateway.afterInit(server);

    expect(realtime.bind).toHaveBeenCalledWith(server);
  });

  it('forgets a socket when it disconnects', async () => {
    const { gateway } = build();
    const socket = fakeSocket();
    await gateway.handleConnection(socket);

    gateway.handleDisconnect(socket);

    // Without the state, a subscribe from that id is refused rather than
    // running against a stale principal.
    await expect(gateway.subscribeToOrder(socket, { orderId: 'order-1' })).resolves.toMatchObject({
      ok: false,
    });
  });

  it('answers a ping', () => {
    const { gateway } = build();

    expect(gateway.handlePing()).toMatchObject({ pong: true });
  });
});
