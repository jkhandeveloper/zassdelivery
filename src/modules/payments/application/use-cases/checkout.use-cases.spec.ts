import { OrderStatus, PaymentMethod, PaymentStatus, UserRole } from '@prisma/client';
import type { LoggerService } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';

import { ResourceNotFoundException } from '@/common/exceptions/domain.exception';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import type { paymentsConfig } from '@/config';
import type {
  OrderRepository,
  OrderWithDetails,
} from '@/modules/orders/domain/repositories/order.repository';

import type {
  PaymentRepository,
  PaymentWithContext,
} from '../../domain/repositories/payment.repository';
import type { PaymentGateway, PaymentGatewayRegistry } from '../../domain/services/payment-gateway';
import { ListGatewaysUseCase, StartCheckoutUseCase } from './checkout.use-cases';

const logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() } as unknown as LoggerService;

const CUSTOMER: AuthenticatedUser = {
  id: 'user-1',
  phone: '+923001234567',
  role: UserRole.CUSTOMER,
  permissions: [],
  sessionId: 'session-1',
};

const CONFIG = {
  publicBaseUrl: 'https://api.zassdelivery.pk',
  checkoutTtlMinutes: 15,
} as ConfigType<typeof paymentsConfig>;

function order(overrides: Record<string, unknown> = {}): OrderWithDetails {
  return {
    id: 'order-1',
    orderNumber: 'ZD-260810-0007',
    status: OrderStatus.PENDING_PAYMENT,
    customerId: 'user-1',
    totalAmount: 1240,
    paymentStatus: PaymentStatus.PENDING,
    ...overrides,
  } as unknown as OrderWithDetails;
}

function attempt(overrides: Partial<PaymentWithContext> = {}): PaymentWithContext {
  return {
    id: 'payment-1',
    reference: 'PAY-260810-0001',
    orderId: 'order-1',
    userId: 'user-1',
    method: PaymentMethod.JAZZCASH,
    status: PaymentStatus.PENDING,
    amount: 1240,
    currency: 'PKR',
    refundedAmount: 0,
    gatewayName: 'jazzcash',
    expiresAt: new Date(Date.now() + 600_000),
    order: { id: 'order-1', orderNumber: 'ZD-260810-0007' },
    user: { id: 'user-1', fullName: 'Ahmad Khan', phone: '+923001234567', email: null },
    ...overrides,
  } as unknown as PaymentWithContext;
}

function build(options: {
  loadedOrder?: OrderWithDetails | null;
  openAttempt?: PaymentWithContext | null;
  configured?: boolean;
  noGateway?: boolean;
}) {
  const orders = {
    findById: jest.fn().mockResolvedValue('loadedOrder' in options ? options.loadedOrder : order()),
  } as unknown as jest.Mocked<OrderRepository>;

  const payments = {
    findOpenForOrder: jest.fn().mockResolvedValue(options.openAttempt ?? null),
    createAttempt: jest
      .fn()
      .mockImplementation((input: { method: PaymentMethod }) =>
        Promise.resolve(attempt({ method: input.method })),
      ),
    fail: jest.fn().mockResolvedValue(attempt({ status: PaymentStatus.CANCELLED })),
  } as unknown as jest.Mocked<PaymentRepository>;

  const gateway = {
    name: 'jazzcash',
    method: PaymentMethod.JAZZCASH,
    isConfigured: () => options.configured ?? true,
    createCheckout: jest.fn().mockReturnValue({
      url: 'https://sandbox.jazzcash.com.pk/checkout',
      method: 'POST',
      fields: { pp_TxnRefNo: 'PAY-260810-0001', pp_SecureHash: 'ABC' },
      reference: 'PAY-260810-0001',
      expiresAt: new Date(),
    }),
  } as unknown as PaymentGateway;

  const gateways = {
    forMethod: jest.fn().mockReturnValue(options.noGateway === true ? null : gateway),
    all: jest.fn().mockReturnValue([gateway]),
  } as unknown as PaymentGatewayRegistry;

  return {
    orders,
    payments,
    gateway,
    gateways,
    useCase: new StartCheckoutUseCase(payments, orders, gateways, CONFIG, logger),
  };
}

describe('ListGatewaysUseCase', () => {
  it('always offers cash and wallet, whatever the gateway credentials are', () => {
    const gateway = {
      name: 'jazzcash',
      method: PaymentMethod.JAZZCASH,
      isConfigured: () => false,
    } as unknown as PaymentGateway;

    const methods = new ListGatewaysUseCase({
      all: () => [gateway],
    } as unknown as PaymentGatewayRegistry).execute();

    expect(methods).toEqual([
      { name: 'cash', method: PaymentMethod.CASH_ON_DELIVERY, available: true },
      { name: 'wallet', method: PaymentMethod.WALLET, available: true },
      { name: 'jazzcash', method: PaymentMethod.JAZZCASH, available: false },
    ]);
  });
});

describe('StartCheckoutUseCase — cash on delivery', () => {
  it('opens a cash attempt and tells the customer to pay the rider', async () => {
    const { useCase, payments } = build({});

    const result = await useCase.execute(
      'order-1',
      { method: PaymentMethod.CASH_ON_DELIVERY },
      CUSTOMER,
    );

    expect(payments.createAttempt).toHaveBeenCalledWith(
      expect.objectContaining({ method: PaymentMethod.CASH_ON_DELIVERY, gatewayName: null }),
    );
    expect(result.action).toBe('ON_DELIVERY');
    expect(result.message).toMatch(/Pay the rider Rs. 1240/);
  });

  it('reuses an existing cash attempt rather than opening a second', async () => {
    const { useCase, payments } = build({
      openAttempt: attempt({ method: PaymentMethod.CASH_ON_DELIVERY, gatewayName: null }),
    });

    await useCase.execute('order-1', { method: PaymentMethod.CASH_ON_DELIVERY }, CUSTOMER);

    expect(payments.createAttempt).not.toHaveBeenCalled();
  });
});

describe('StartCheckoutUseCase — gateways', () => {
  it('returns signed fields for the client to post', async () => {
    const { useCase } = build({});

    const result = await useCase.execute('order-1', { method: PaymentMethod.JAZZCASH }, CUSTOMER);

    expect(result.action).toBe('REDIRECT');
    expect(result.checkout?.url).toBe('https://sandbox.jazzcash.com.pk/checkout');
    expect(result.checkout?.fields.pp_SecureHash).toBe('ABC');
  });

  it('gives the gateway our reference and the order number', async () => {
    const { useCase, gateway } = build({});

    await useCase.execute('order-1', { method: PaymentMethod.JAZZCASH }, CUSTOMER);

    expect(gateway.createCheckout).toHaveBeenCalledWith(
      expect.objectContaining({
        reference: 'PAY-260810-0001',
        orderNumber: 'ZD-260810-0007',
        amount: 1240,
      }),
    );
  });

  it('reuses an unexpired attempt for the same method', async () => {
    const { useCase, payments } = build({ openAttempt: attempt() });

    await useCase.execute('order-1', { method: PaymentMethod.JAZZCASH }, CUSTOMER);

    // Two live attempts against one order is how a customer pays twice.
    expect(payments.createAttempt).not.toHaveBeenCalled();
  });

  it('cancels the old attempt when the customer switches method', async () => {
    const { useCase, payments } = build({
      openAttempt: attempt({ method: PaymentMethod.EASYPAISA, gatewayName: 'easypaisa' }),
    });

    await useCase.execute('order-1', { method: PaymentMethod.JAZZCASH }, CUSTOMER);

    expect(payments.fail).toHaveBeenCalledWith(
      expect.objectContaining({ status: PaymentStatus.CANCELLED, failOrder: false }),
    );
    expect(payments.createAttempt).toHaveBeenCalled();
  });

  it('opens a fresh attempt when the previous one has expired', async () => {
    const { useCase, payments } = build({
      openAttempt: attempt({ expiresAt: new Date(Date.now() - 1000) }),
    });

    await useCase.execute('order-1', { method: PaymentMethod.JAZZCASH }, CUSTOMER);

    expect(payments.createAttempt).toHaveBeenCalled();
  });

  it('refuses a gateway this deployment has no credentials for', async () => {
    const { useCase, payments } = build({ configured: false });

    await expect(
      useCase.execute('order-1', { method: PaymentMethod.JAZZCASH }, CUSTOMER),
    ).rejects.toThrow(/not available on this deployment/);
    expect(payments.createAttempt).not.toHaveBeenCalled();
  });
});

describe('StartCheckoutUseCase — guards', () => {
  it('refuses an order that is already paid for', async () => {
    const { useCase } = build({
      loadedOrder: order({ paymentStatus: PaymentStatus.PAID }),
    });

    await expect(
      useCase.execute('order-1', { method: PaymentMethod.JAZZCASH }, CUSTOMER),
    ).rejects.toThrow(/already been paid/);
  });

  it('refuses an order that has been delivered', async () => {
    const { useCase } = build({ loadedOrder: order({ status: OrderStatus.DELIVERED }) });

    await expect(
      useCase.execute('order-1', { method: PaymentMethod.JAZZCASH }, CUSTOMER),
    ).rejects.toThrow(/cannot start a new payment/);
  });

  it('lets an unpaid placed order start a payment, for a customer switching from cash', async () => {
    const { useCase } = build({ loadedOrder: order({ status: OrderStatus.PLACED }) });

    await expect(
      useCase.execute('order-1', { method: PaymentMethod.JAZZCASH }, CUSTOMER),
    ).resolves.toMatchObject({ action: 'REDIRECT' });
  });

  it('will not let one customer pay for another customer’s order', async () => {
    const { useCase } = build({ loadedOrder: order({ customerId: 'someone-else' }) });

    await expect(
      useCase.execute('order-1', { method: PaymentMethod.JAZZCASH }, CUSTOMER),
    ).rejects.toThrow(ResourceNotFoundException);
  });

  it('reports an unknown order as not found', async () => {
    const { useCase } = build({ loadedOrder: null });

    await expect(
      useCase.execute('missing', { method: PaymentMethod.JAZZCASH }, CUSTOMER),
    ).rejects.toThrow(ResourceNotFoundException);
  });

  it('sends a wallet payer back to checkout, where the balance is actually debited', async () => {
    const { useCase } = build({});

    await expect(
      useCase.execute('order-1', { method: PaymentMethod.WALLET }, CUSTOMER),
    ).rejects.toThrow(/paymentMethod=WALLET/);
  });
});
