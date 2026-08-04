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
import type { RiderSettingsService } from '../services/rider-settings.service';
import { ConfirmDeliveryUseCase, PickupOrderUseCase } from './delivery.use-cases';
import type { AssignmentAccessService } from './dispatch.use-cases';

const RIDER: AuthenticatedUser = {
  id: 'user-1',
  phone: '+923005551234',
  role: UserRole.RIDER,
  permissions: [],
  sessionId: 'session-1',
};

const RATES = { baseFare: 60, perKm: 18, tipSharePercentage: 100, minimumFare: 80 };

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
      tipAmount: 50,
      totalAmount: 1240,
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
    creditDeliveryEarnings: jest
      .fn()
      .mockImplementation(({ total }: { total: number }) => Promise.resolve(total)),
  } as unknown as jest.Mocked<RiderFinanceRepository>;

  const settings = {
    earningRates: jest.fn().mockResolvedValue(RATES),
  } as unknown as jest.Mocked<RiderSettingsService>;

  return { access, assignments, advance, notifications, finance, settings };
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
        parts.settings,
      ),
    };
  }

  it('completes the delivery and credits the itemised fare on the right code', async () => {
    const { useCase, advance, assignments, finance } = build(assignment(issued));

    const result = await useCase.execute('order-1', { code: '4821' }, RIDER);

    expect(advance.execute).toHaveBeenCalledWith('order-1', OrderStatus.DELIVERED, RIDER, {
      otpVerified: true,
    });
    expect(assignments.complete).toHaveBeenCalledWith('assignment-1');
    // 60 base + 45 distance + 50 tip.
    expect(result.earned).toBe(155);
    expect(finance.creditDeliveryEarnings).toHaveBeenCalledWith(
      expect.objectContaining({ driverId: 'rider-1', orderId: 'order-1', total: 155 }),
    );
  });

  it('returns the fare broken down into its components', async () => {
    const { useCase } = build(assignment(issued));

    const result = await useCase.execute('order-1', { code: '4821' }, RIDER);

    expect(result.breakdown.map((line) => line.type)).toEqual(['BASE_FARE', 'DISTANCE', 'TIP']);
  });

  it('counts a wrong code as an attempt and leaves the order undelivered', async () => {
    const { useCase, advance, assignments, finance } = build(assignment(issued));

    await expect(useCase.execute('order-1', { code: '0000' }, RIDER)).rejects.toThrow(
      BusinessRuleViolationException,
    );

    expect(assignments.recordOtpFailure).toHaveBeenCalledWith('assignment-1');
    expect(advance.execute).not.toHaveBeenCalled();
    expect(finance.creditDeliveryEarnings).not.toHaveBeenCalled();
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

  it('pays the minimum fare on a very short run', async () => {
    const shortRun = assignment(issued);
    Object.assign(shortRun.order, { distanceKm: 0.2, tipAmount: 0 });

    const { useCase } = build(shortRun);

    const result = await useCase.execute('order-1', { code: '4821' }, RIDER);

    expect(result.earned).toBe(80);
  });
});
