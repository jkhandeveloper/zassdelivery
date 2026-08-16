import {
  AssignmentStatus,
  DriverAvailability,
  DriverStatus,
  OrderStatus,
  UserRole,
} from '@prisma/client';

import { ResourceNotFoundException } from '@/common/exceptions/domain.exception';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import type {
  OrderRepository,
  OrderWithDetails,
} from '@/modules/orders/domain/repositories/order.repository';

import type { RealtimeService } from '@/modules/realtime/application/realtime.service';

import type { AssignmentRepository } from '../../domain/repositories/assignment.repository';
import type { RiderRepository, RiderWithDetails } from '../../domain/repositories/rider.repository';
import { DispatchService } from '../../domain/services/dispatch.service';
import { EarningsCalculator } from '../../domain/services/earnings.calculator';
import type { RiderSettingsService } from '../services/rider-settings.service';
import { AssignOrderUseCase } from './dispatch.use-cases';

const DISPATCHER: AuthenticatedUser = {
  id: 'admin-1',
  phone: '+923000000001',
  role: UserRole.ADMIN,
  permissions: ['orders.assign'],
  staffRestaurantId: null,
  sessionId: 'session-1',
};

const PICKUP = { latitude: 34.0151, longitude: 71.7938 };

function order(overrides: Record<string, unknown> = {}): OrderWithDetails {
  return {
    id: 'order-1',
    orderNumber: 'ZD-260809-0007',
    status: OrderStatus.READY_FOR_PICKUP,
    driverId: null,
    zoneId: 'zone-pabbi',
    distanceKm: 2.5,
    restaurant: { id: 'restaurant-1', name: 'Chapli Kabab House', ...PICKUP },
    ...overrides,
  } as unknown as OrderWithDetails;
}

function candidate(overrides: Record<string, unknown> = {}) {
  return {
    driverId: 'rider-1',
    zoneId: 'zone-pabbi',
    currentLat: 34.016,
    currentLng: 71.794,
    lastLocationAt: new Date(),
    rating: 4.5,
    hasRejectedThisOrder: false,
    ...overrides,
  };
}

function build(options: {
  loadedOrder?: OrderWithDetails | null;
  candidates?: ReturnType<typeof candidate>[];
  namedRider?: RiderWithDetails | null;
}) {
  const orders = {
    findById: jest.fn().mockResolvedValue('loadedOrder' in options ? options.loadedOrder : order()),
  } as unknown as jest.Mocked<OrderRepository>;

  const riders = {
    findDispatchCandidates: jest.fn().mockResolvedValue(options.candidates ?? [candidate()]),
    findById: jest.fn().mockResolvedValue(options.namedRider ?? null),
  } as unknown as jest.Mocked<RiderRepository>;

  const assignments = {
    offer: jest.fn().mockImplementation((input: Record<string, unknown>) =>
      Promise.resolve({
        id: 'assignment-1',
        status: AssignmentStatus.OFFERED,
        driverId: input.driverId,
        pickupDistanceKm: input.pickupDistanceKm,
        estimatedEarning: input.estimatedEarning,
        isAuto: input.isAuto,
        offeredAt: new Date(),
        expiresAt: input.expiresAt,
        respondedAt: null,
        completedAt: null,
        rejectionReason: null,
        otpHash: null,
        otpVerifiedAt: null,
        orderId: 'order-1',
        order: order().restaurant
          ? {
              ...order(),
              restaurant: { ...order().restaurant, addressLine: 'Main GT Road' },
              customer: { fullName: 'Ahmad Khan', phone: '+923001234567' },
            }
          : null,
      }),
    ),
  } as unknown as jest.Mocked<AssignmentRepository>;

  const settings = {
    dispatch: jest.fn().mockResolvedValue({
      offerTimeoutSeconds: 60,
      searchRadiusKm: 8,
      locationFreshnessMinutes: 10,
    }),
    earningRates: jest
      .fn()
      .mockResolvedValue({ baseFare: 60, perKm: 18, tipSharePercentage: 100, minimumFare: 80 }),
  } as unknown as jest.Mocked<RiderSettingsService>;

  const realtime = {
    deliveryOffered: jest.fn(),
    riderAssigned: jest.fn(),
  } as unknown as jest.Mocked<RealtimeService>;

  return {
    orders,
    riders,
    assignments,
    settings,
    realtime,
    useCase: new AssignOrderUseCase(
      assignments,
      riders,
      orders,
      new DispatchService(),
      new EarningsCalculator(),
      settings,
      realtime,
    ),
  };
}

describe('AssignOrderUseCase — automatic dispatch', () => {
  it('offers the order to the best available rider', async () => {
    const { useCase, assignments } = build({
      candidates: [
        candidate({ driverId: 'far', currentLat: 34.06, currentLng: 71.84 }),
        candidate({ driverId: 'near' }),
      ],
    });

    await useCase.execute('order-1', {}, DISPATCHER);

    expect(assignments.offer).toHaveBeenCalledWith(
      expect.objectContaining({ driverId: 'near', isAuto: true, assignedById: null }),
    );
  });

  it('quotes the fare the rider will earn, excluding any tip', async () => {
    const { useCase, assignments } = build({});

    await useCase.execute('order-1', {}, DISPATCHER);

    // 60 base + 2.5 km at 18/km.
    expect(assignments.offer).toHaveBeenCalledWith(
      expect.objectContaining({ estimatedEarning: 105 }),
    );
  });

  it('refuses when no rider is available', async () => {
    const { useCase, assignments } = build({ candidates: [] });

    await expect(useCase.execute('order-1', {}, DISPATCHER)).rejects.toThrow(
      /No rider is available/,
    );
    expect(assignments.offer).not.toHaveBeenCalled();
  });

  it('starts dispatching as soon as the restaurant has confirmed', async () => {
    const { useCase, assignments } = build({
      loadedOrder: order({ status: OrderStatus.CONFIRMED }),
    });

    await useCase.execute('order-1', {}, DISPATCHER);

    expect(assignments.offer).toHaveBeenCalled();
  });

  it('refuses to dispatch an order the restaurant has not accepted yet', async () => {
    const { useCase } = build({ loadedOrder: order({ status: OrderStatus.PLACED }) });

    await expect(useCase.execute('order-1', {}, DISPATCHER)).rejects.toThrow(
      /must be confirmed by the restaurant first/,
    );
  });

  it('refuses to dispatch a cancelled order', async () => {
    const { useCase } = build({ loadedOrder: order({ status: OrderStatus.CANCELLED }) });

    await expect(useCase.execute('order-1', {}, DISPATCHER)).rejects.toThrow(
      /cannot be dispatched/,
    );
  });

  it('refuses to dispatch an order that already has a rider', async () => {
    const { useCase } = build({ loadedOrder: order({ driverId: 'rider-9' }) });

    await expect(useCase.execute('order-1', {}, DISPATCHER)).rejects.toThrow(/already has a rider/);
  });

  it('reports an unknown order as not found', async () => {
    const { useCase } = build({ loadedOrder: null });

    await expect(useCase.execute('missing', {}, DISPATCHER)).rejects.toThrow(
      ResourceNotFoundException,
    );
  });

  it('honours a caller-supplied offer timeout', async () => {
    const { useCase, assignments } = build({});
    const before = Date.now();

    await useCase.execute('order-1', { timeoutSeconds: 120 }, DISPATCHER);

    const { expiresAt } = (assignments.offer as jest.Mock).mock.calls[0][0] as { expiresAt: Date };

    expect(expiresAt.getTime() - before).toBeGreaterThanOrEqual(119_000);
    expect(expiresAt.getTime() - before).toBeLessThanOrEqual(121_000);
  });
});

describe('AssignOrderUseCase — dispatcher naming a rider', () => {
  function namedRider(overrides: Partial<RiderWithDetails> = {}): RiderWithDetails {
    return {
      id: 'rider-7',
      status: DriverStatus.ACTIVE,
      availability: DriverAvailability.ONLINE,
      zoneId: 'zone-pabbi',
      currentLat: 34.02,
      currentLng: 71.8,
      lastLocationAt: new Date(),
      rating: 4,
      ...overrides,
    } as unknown as RiderWithDetails;
  }

  it('offers the run to the named rider and records who assigned it', async () => {
    const { useCase, assignments } = build({ namedRider: namedRider() });

    await useCase.execute('order-1', { driverId: 'rider-7' }, DISPATCHER);

    expect(assignments.offer).toHaveBeenCalledWith(
      expect.objectContaining({ driverId: 'rider-7', isAuto: false, assignedById: DISPATCHER.id }),
    );
  });

  it('offers the run even to a rider outside the automatic search radius', async () => {
    const { useCase, assignments } = build({
      namedRider: namedRider({ currentLat: 34.4, currentLng: 72.2 }),
    });

    await useCase.execute('order-1', { driverId: 'rider-7' }, DISPATCHER);

    expect(assignments.offer).toHaveBeenCalled();
  });

  it('refuses a rider who is not approved', async () => {
    const { useCase } = build({ namedRider: namedRider({ status: DriverStatus.SUSPENDED }) });

    await expect(useCase.execute('order-1', { driverId: 'rider-7' }, DISPATCHER)).rejects.toThrow(
      /suspended and cannot be given deliveries/,
    );
  });

  it('refuses a rider who is already carrying an order', async () => {
    const { useCase } = build({
      namedRider: namedRider({ availability: DriverAvailability.ON_DELIVERY }),
    });

    await expect(useCase.execute('order-1', { driverId: 'rider-7' }, DISPATCHER)).rejects.toThrow(
      /cannot take another delivery/,
    );
  });

  it('refuses a rider who has gone offline', async () => {
    const { useCase } = build({
      namedRider: namedRider({ availability: DriverAvailability.OFFLINE }),
    });

    await expect(useCase.execute('order-1', { driverId: 'rider-7' }, DISPATCHER)).rejects.toThrow(
      /cannot take another delivery/,
    );
  });

  it('reports an unknown rider as not found', async () => {
    const { useCase } = build({ namedRider: null });

    await expect(useCase.execute('order-1', { driverId: 'nobody' }, DISPATCHER)).rejects.toThrow(
      ResourceNotFoundException,
    );
  });
});
