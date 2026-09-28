import {
  AssignmentStatus,
  DriverAvailability,
  DriverStatus,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  UserRole,
} from '@prisma/client';

import { BusinessRuleViolationException } from '@/common/exceptions/domain.exception';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import type { AdvanceOrderUseCase } from '@/modules/orders/application/use-cases/order-lifecycle.use-cases';

import type {
  AssignmentRepository,
  AssignmentWithOrder,
} from '../../domain/repositories/assignment.repository';
import type { DeliveryNotificationPort } from '../../domain/repositories/delivery-notification.port';
import type { RiderFinanceRepository } from '../../domain/repositories/rider-finance.repository';
import type { RiderWithDetails } from '../../domain/repositories/rider.repository';
import { DeliveryOtpService } from '../../domain/services/delivery-otp.service';
import { EarningsCalculator } from '../../domain/services/earnings.calculator';
import { ConfirmDeliveryUseCase, PickupOrderUseCase } from './delivery.use-cases';
import type { AssignmentAccessService } from './dispatch.use-cases';

const RIDER: AuthenticatedUser = {
  id: 'user-1',
  phone: '+923005551234',
  role: UserRole.RIDER,
  permissions: [],
  staffRestaurantId: null,
  sessionId: 'session-1',
};

const otpService = new DeliveryOtpService();

function riderProfile(): RiderWithDetails {
  return {
    id: 'rider-1',
    userId: 'user-1',
    status: DriverStatus.ACTIVE,
    availability: DriverAvailability.ON_DELIVERY,
    user: { id: 'user-1', fullName: 'Bilal Ahmed', phone: '+923005551234' },
  } as unknown as RiderWithDetails;
}

function assignment(overrides: Partial<AssignmentWithOrder> = {}): AssignmentWithOrder {
  return {
    id: 'assignment-1',
    orderId: 'order-1',
    driverId: 'rider-1',
    status: AssignmentStatus.ACCEPTED,
    otpHash: null,
    otpIssuedAt: null,
    otpAttempts: 0,
    otpVerifiedAt: null,
    expiresAt: new Date(Date.now() + 60_000),
    order: {
      id: 'order-1',
      orderNumber: 'ZD-260809-0007',
      status: OrderStatus.ON_THE_WAY,
      customerId: 'customer-1',
      distanceKm: 2.5,
      deliveryFee: 100,
      tipAmount: 50,
      totalAmount: 1240,
      restaurant: { id: 'restaurant-1', name: 'Chapli Kabab House' },
      paymentMethod: PaymentMethod.CASH_ON_DELIVERY,
      paymentStatus: PaymentStatus.PENDING,
    },
    ...overrides,
  } as unknown as AssignmentWithOrder;
}

function mocks(loaded: AssignmentWithOrder) {
  const access = {
    forOrder: jest.fn().mockResolvedValue({ assignment: loaded, rider: riderProfile() }),
  } as unknown as jest.Mocked<AssignmentAccessService>;

  const assignments = {
    storeOtp: jest.fn().mockResolvedValue(undefined),
    recordOtpFailure: jest.fn().mockResolvedValue(undefined),
    complete: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<AssignmentRepository>;

  const advance = {
    execute: jest.fn().mockResolvedValue({}),
  } as unknown as jest.Mocked<AdvanceOrderUseCase>;

  const notifications = {
    sendDeliveryCode: jest.fn().mockResolvedValue(undefined),
    sendRiderAssigned: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<DeliveryNotificationPort>;

  const finance = {
    recordDelivery: jest
      .fn()
      .mockImplementation(({ total, totalAmount }: { total: number; totalAmount: number }) =>
        Promise.resolve({ earned: total, collected: totalAmount, net: totalAmount - total }),
      ),
  } as unknown as jest.Mocked<RiderFinanceRepository>;

  return { access, assignments, advance, notifications, finance };
}

describe('PickupOrderUseCase', () => {
  it('advances the order and issues a delivery code the customer is sent', async () => {
    const loaded = assignment();
    const { access, assignments, advance, notifications } = mocks(loaded);
    const useCase = new PickupOrderUseCase(assignments, access, advance, otpService, notifications);

    const result = await useCase.execute('order-1', RIDER);

    expect(advance.execute).toHaveBeenCalledWith('order-1', OrderStatus.PICKED_UP, RIDER);
    expect(assignments.storeOtp).toHaveBeenCalledWith(
      'assignment-1',
      expect.any(String),
      expect.any(Date),
    );
    expect(notifications.sendDeliveryCode).toHaveBeenCalledWith(
      expect.objectContaining({ customerId: 'customer-1', code: expect.stringMatching(/^\d{4}$/) }),
    );
    expect(result.codeSent).toBe(true);
  });

  it('stores only a hash of the code, never the code itself', async () => {
    const loaded = assignment();
    const { access, assignments, advance, notifications } = mocks(loaded);
    const useCase = new PickupOrderUseCase(assignments, access, advance, otpService, notifications);

    await useCase.execute('order-1', RIDER);

    const sentCode = (notifications.sendDeliveryCode as jest.Mock).mock.calls[0][0].code as string;
    const storedHash = (assignments.storeOtp as jest.Mock).mock.calls[0][1] as string;

    expect(storedHash).not.toContain(sentCode);
    expect(storedHash).toBe(otpService.hash(sentCode, 'assignment-1'));
  });

  it('never returns the code to the rider', async () => {
    const loaded = assignment();
    const { access, assignments, advance, notifications } = mocks(loaded);
    const useCase = new PickupOrderUseCase(assignments, access, advance, otpService, notifications);

    const result = await useCase.execute('order-1', RIDER);

    expect(JSON.stringify(result)).not.toMatch(/\b\d{4}\b/);
  });

  it('refuses to collect an order the rider has not accepted', async () => {
    const loaded = assignment({ status: AssignmentStatus.OFFERED });
    const { access, assignments, advance, notifications } = mocks(loaded);
    const useCase = new PickupOrderUseCase(assignments, access, advance, otpService, notifications);

    await expect(useCase.execute('order-1', RIDER)).rejects.toThrow(/Accept this delivery/);
    expect(advance.execute).not.toHaveBeenCalled();
  });
});

describe('ConfirmDeliveryUseCase', () => {
  const issued = {
    otpHash: otpService.hash('4821', 'assignment-1'),
    otpIssuedAt: new Date(),
  };

  function build(loaded: AssignmentWithOrder) {
    const parts = mocks(loaded);

    return {
      ...parts,
      useCase: new ConfirmDeliveryUseCase(
        parts.assignments,
        parts.access,
        parts.advance,
        otpService,
        parts.finance,
        new EarningsCalculator(),
      ),
    };
  }

  it('completes the delivery and records the fee and tip on the right code', async () => {
    const { useCase, advance, assignments, finance } = build(assignment(issued));

    const result = await useCase.execute('order-1', { code: '4821' }, RIDER);

    expect(advance.execute).toHaveBeenCalledWith('order-1', OrderStatus.DELIVERED, RIDER, {
      otpVerified: true,
    });
    expect(assignments.complete).toHaveBeenCalledWith('assignment-1');
    // 100 delivery fee + 50 tip.
    expect(result.earned).toBe(150);
    expect(finance.recordDelivery).toHaveBeenCalledWith(
      expect.objectContaining({
        driverId: 'rider-1',
        restaurantId: 'restaurant-1',
        orderId: 'order-1',
        totalAmount: 1240,
        total: 150,
      }),
    );
  });

  it('returns the fee and the tip as separate lines', async () => {
    const { useCase } = build(assignment(issued));

    const result = await useCase.execute('order-1', { code: '4821' }, RIDER);

    expect(result.breakdown.map((line) => line.type)).toEqual(['DELIVERY_FEE', 'TIP']);
  });

  it('tells a rider who collected cash how much to hand the business', async () => {
    const { useCase } = build(assignment(issued));

    const result = await useCase.execute('order-1', { code: '4821' }, RIDER);

    expect(result.owedToRestaurant).toBe(1090);
    expect(result.owedByRestaurant).toBe(0);
    expect(result.message).toMatch(/hand Rs\. 1090 to Chapli Kabab House/);
  });

  it('tells a rider on a prepaid order that the business owes them the fee', async () => {
    const { useCase, finance } = build(assignment(issued));
    (finance.recordDelivery as jest.Mock).mockResolvedValueOnce({
      earned: 150,
      collected: 0,
      net: -150,
    });

    const result = await useCase.execute('order-1', { code: '4821' }, RIDER);

    expect(result.owedToRestaurant).toBe(0);
    expect(result.owedByRestaurant).toBe(150);
    expect(result.message).toMatch(/Chapli Kabab House owes you Rs\. 150/);
  });

  it('counts a wrong code as an attempt and leaves the order undelivered', async () => {
    const { useCase, advance, assignments, finance } = build(assignment(issued));

    await expect(useCase.execute('order-1', { code: '0000' }, RIDER)).rejects.toThrow(
      BusinessRuleViolationException,
    );

    expect(assignments.recordOtpFailure).toHaveBeenCalledWith('assignment-1');
    expect(advance.execute).not.toHaveBeenCalled();
    expect(finance.recordDelivery).not.toHaveBeenCalled();
  });

  it('refuses once the attempt cap is spent, even with the right code', async () => {
    const { useCase, advance } = build(assignment({ ...issued, otpAttempts: 5 }));

    await expect(useCase.execute('order-1', { code: '4821' }, RIDER)).rejects.toThrow(
      /Too many incorrect codes/,
    );
    expect(advance.execute).not.toHaveBeenCalled();
  });

  it('refuses when no code has been issued, i.e. the order was never collected', async () => {
    const { useCase } = build(assignment());

    await expect(useCase.execute('order-1', { code: '4821' }, RIDER)).rejects.toThrow(
      /Collect the order first/,
    );
  });

  it('refuses to confirm a delivery that is no longer the rider’s', async () => {
    const { useCase } = build(assignment({ ...issued, status: AssignmentStatus.CANCELLED }));

    await expect(useCase.execute('order-1', { code: '4821' }, RIDER)).rejects.toThrow(
      /cancelled and cannot be confirmed/,
    );
  });

  it('earns nothing on a free-delivery order without a tip', async () => {
    const freeRun = assignment(issued);
    Object.assign(freeRun.order, { deliveryFee: 0, tipAmount: 0 });

    const { useCase } = build(freeRun);

    const result = await useCase.execute('order-1', { code: '4821' }, RIDER);

    expect(result.earned).toBe(0);
    expect(result.breakdown).toEqual([]);
  });
});
