import { ActorType, OrderStatus, PaymentMethod, PaymentStatus, UserRole } from '@prisma/client';
import type { LoggerService } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';

import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import type { paymentsConfig } from '@/config';
import type { OrderAccessService } from '@/modules/orders/application/use-cases/order-lifecycle.use-cases';
import type {
  OrderRepository,
  OrderWithDetails,
} from '@/modules/orders/domain/repositories/order.repository';

import type {
  PaymentRepository,
  PaymentWithContext,
} from '../../domain/repositories/payment.repository';
import type { PaymentGatewayRegistry } from '../../domain/services/payment-gateway';
import { StartCheckoutUseCase } from './checkout.use-cases';
import { GetOrderPaymentQrUseCase, MarkPaymentReceivedUseCase } from './scan-to-pay.use-cases';

const logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() } as unknown as LoggerService;

const CONFIG = { checkoutTtlMinutes: 15 } as ConfigType<typeof paymentsConfig>;

const RESTAURANT_QR = {
  provider: 'JAZZCASH',
  label: null,
  accountTitle: 'Chapli Kabab House',
  accountNumber: '03001234567',
  imageUrl: 'https://api.zassdelivery.pk/api/v1/uploads/payment-qr-codes/a.png',
};

const RIDER_QR = {
  provider: 'EASYPAISA',
  label: null,
  accountTitle: 'Bilal Ahmed',
  accountNumber: null,
  imageUrl: 'https://api.zassdelivery.pk/api/v1/uploads/payment-qr-codes/b.png',
};

function user(role: UserRole, id = 'user-1'): AuthenticatedUser {
  return {
    id,
    phone: '+923001234567',
    role,
    permissions: [],
    staffRestaurantId: null,
    sessionId: 'session-1',
  };
}

function order(overrides: Record<string, unknown> = {}): OrderWithDetails {
  return {
    id: 'order-1',
    orderNumber: 'ZD-260910-0007',
    status: OrderStatus.PLACED,
    customerId: 'user-1',
    totalAmount: 1240,
    currency: 'PKR',
    paymentMethod: PaymentMethod.QR_TRANSFER,
    paymentStatus: PaymentStatus.PENDING,
    restaurant: { id: 'restaurant-1', name: 'Chapli Kabab House', paymentQrCodes: [RESTAURANT_QR] },
    driver: null,
    ...overrides,
  } as unknown as OrderWithDetails;
}

const WITH_RIDER = {
  driver: {
    id: 'driver-1',
    userId: 'rider-user',
    paymentQrCodes: [RIDER_QR],
    user: { fullName: 'Bilal Ahmed', phone: '+923005551234' },
  },
};

function attempt(overrides: Partial<PaymentWithContext> = {}): PaymentWithContext {
  return {
    id: 'payment-1',
    reference: null,
    orderId: 'order-1',
    userId: 'user-1',
    method: PaymentMethod.QR_TRANSFER,
    status: PaymentStatus.PENDING,
    amount: 1240,
    currency: 'PKR',
    refundedAmount: 0,
    gatewayName: null,
    gatewayTransactionId: null,
    failureReason: null,
    expiresAt: null,
    paidAt: null,
    failedAt: null,
    createdAt: new Date(),
    order: { id: 'order-1', orderNumber: 'ZD-260910-0007' },
    user: { id: 'user-1', fullName: 'Ahmad Khan', phone: '+923001234567', email: null },
    ...overrides,
  } as unknown as PaymentWithContext;
}

function accessFor(loaded: OrderWithDetails, as: ActorType): OrderAccessService {
  return {
    loadFor: jest.fn().mockResolvedValue({ order: loaded, as }),
  } as unknown as OrderAccessService;
}

describe('StartCheckoutUseCase — scan to pay', () => {
  function build(loaded: OrderWithDetails, open: PaymentWithContext | null = attempt()) {
    const orders = {
      findById: jest.fn().mockResolvedValue(loaded),
    } as unknown as OrderRepository;

    const payments = {
      findOpenForOrder: jest.fn().mockResolvedValue(open),
      createAttempt: jest.fn().mockResolvedValue(attempt({ id: 'payment-2' })),
      fail: jest.fn(),
    } as unknown as jest.Mocked<PaymentRepository>;

    const gateways = { forMethod: jest.fn() } as unknown as PaymentGatewayRegistry;

    return {
      payments,
      useCase: new StartCheckoutUseCase(payments, orders, gateways, CONFIG, logger),
    };
  }

  it('hands back the restaurant’s codes and reuses the attempt opened with the order', async () => {
    const { useCase, payments } = build(order());

    const result = await useCase.execute(
      'order-1',
      { method: PaymentMethod.QR_TRANSFER },
      user(UserRole.CUSTOMER),
    );

    expect(result.action).toBe('SCAN_QR');
    expect(result.qrCodes).toEqual([RESTAURANT_QR]);
    expect(result.message).toMatch(/ZD-260910-0007/);
    expect(payments.createAttempt).not.toHaveBeenCalled();
  });

  it('refuses to turn a cash order into scan-to-pay after it is placed', async () => {
    const { useCase } = build(order({ paymentMethod: PaymentMethod.CASH_ON_DELIVERY }));

    await expect(
      useCase.execute('order-1', { method: PaymentMethod.QR_TRANSFER }, user(UserRole.CUSTOMER)),
    ).rejects.toThrow(/chosen when the order is placed/);
  });

  it('refuses when the restaurant has since taken its codes down', async () => {
    const { useCase } = build(
      order({ restaurant: { id: 'restaurant-1', name: 'Chapli Kabab House', paymentQrCodes: [] } }),
    );

    await expect(
      useCase.execute('order-1', { method: PaymentMethod.QR_TRANSFER }, user(UserRole.CUSTOMER)),
    ).rejects.toThrow(/no longer takes scan-to-pay/);
  });
});

describe('MarkPaymentReceivedUseCase', () => {
  function build(loaded: OrderWithDetails, as: ActorType) {
    const payments = {
      settleManualTransfer: jest
        .fn()
        .mockResolvedValue(attempt({ status: PaymentStatus.PAID, paidAt: new Date() })),
    } as unknown as jest.Mocked<PaymentRepository>;

    return { payments, useCase: new MarkPaymentReceivedUseCase(accessFor(loaded, as), payments) };
  }

  it('settles the order as received by the rider who has it', async () => {
    const { useCase, payments } = build(order(WITH_RIDER), ActorType.DRIVER);

    const result = await useCase.execute(
      'order-1',
      { channel: 'EASYPAISA', reference: 'TID12345678' },
      user(UserRole.RIDER, 'rider-user'),
    );

    expect(payments.settleManualTransfer).toHaveBeenCalledWith({
      orderId: 'order-1',
      userId: 'user-1',
      amount: 1240,
      channel: 'EASYPAISA',
      reference: 'TID12345678',
      recipient: 'RIDER',
      recordedBy: 'rider-user',
      description: 'Paid by Easypaisa to rider Bilal Ahmed',
    });
    expect(result.status).toBe(PaymentStatus.PAID);
  });

  it('lets a cash order be paid by QR instead, confirmed by the restaurant', async () => {
    const { useCase, payments } = build(
      order({ paymentMethod: PaymentMethod.CASH_ON_DELIVERY }),
      ActorType.RESTAURANT,
    );

    await useCase.execute('order-1', { channel: 'JAZZCASH' }, user(UserRole.VENDOR_OWNER, 'owner'));

    expect(payments.settleManualTransfer).toHaveBeenCalledWith(
      expect.objectContaining({
        recipient: 'RESTAURANT',
        reference: null,
        description: 'Paid by JazzCash to Chapli Kabab House',
      }),
    );
  });

  it('never takes the customer’s word that they paid', async () => {
    const { useCase, payments } = build(order(), ActorType.CUSTOMER);

    await expect(
      useCase.execute('order-1', { channel: 'JAZZCASH' }, user(UserRole.CUSTOMER)),
    ).rejects.toThrow(/restaurant or your rider/);
    expect(payments.settleManualTransfer).not.toHaveBeenCalled();
  });

  it('refuses an order that has already been paid for', async () => {
    const { useCase } = build(order({ paymentStatus: PaymentStatus.PAID }), ActorType.RESTAURANT);

    await expect(
      useCase.execute('order-1', { channel: 'JAZZCASH' }, user(UserRole.VENDOR_OWNER, 'owner')),
    ).rejects.toThrow(/already been paid/);
  });

  it('refuses an order a gateway is settling', async () => {
    const { useCase } = build(
      order({ paymentMethod: PaymentMethod.JAZZCASH, status: OrderStatus.PENDING_PAYMENT }),
      ActorType.ADMIN,
    );

    await expect(
      useCase.execute('order-1', { channel: 'JAZZCASH' }, user(UserRole.ADMIN, 'admin')),
    ).rejects.toThrow(/gateway/);
  });

  it('refuses an order that was cancelled', async () => {
    const { useCase } = build(order({ status: OrderStatus.CANCELLED }), ActorType.RESTAURANT);

    await expect(
      useCase.execute('order-1', { channel: 'JAZZCASH' }, user(UserRole.VENDOR_OWNER, 'owner')),
    ).rejects.toThrow(/cancelled/);
  });
});

describe('GetOrderPaymentQrUseCase', () => {
  it('shows the customer the restaurant’s codes, and the rider’s once one has the order', async () => {
    const useCase = new GetOrderPaymentQrUseCase(accessFor(order(WITH_RIDER), ActorType.CUSTOMER));

    const result = await useCase.execute('order-1', user(UserRole.CUSTOMER));

    expect(result.amount).toBe(1240);
    expect(result.restaurant).toEqual({ name: 'Chapli Kabab House', codes: [RESTAURANT_QR] });
    expect(result.rider).toEqual({ name: 'Bilal Ahmed', codes: [RIDER_QR] });
  });

  it('has no rider codes before a rider takes the order', async () => {
    const useCase = new GetOrderPaymentQrUseCase(accessFor(order(), ActorType.CUSTOMER));

    expect((await useCase.execute('order-1', user(UserRole.CUSTOMER))).rider).toBeNull();
  });

  it('drops a malformed stored entry rather than showing a code that pays nobody', async () => {
    const useCase = new GetOrderPaymentQrUseCase(
      accessFor(
        order({
          restaurant: {
            name: 'Chapli Kabab House',
            paymentQrCodes: [RESTAURANT_QR, { provider: 'JAZZCASH' }, 'nonsense'],
          },
        }),
        ActorType.CUSTOMER,
      ),
    );

    expect((await useCase.execute('order-1', user(UserRole.CUSTOMER))).restaurant.codes).toEqual([
      RESTAURANT_QR,
    ]);
  });

  it('is not for the kitchen', async () => {
    const useCase = new GetOrderPaymentQrUseCase(accessFor(order(), ActorType.RESTAURANT));

    await expect(useCase.execute('order-1', user(UserRole.VENDOR_OWNER, 'owner'))).rejects.toThrow(
      /Only the customer/,
    );
  });
});
