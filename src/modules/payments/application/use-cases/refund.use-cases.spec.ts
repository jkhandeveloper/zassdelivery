import { PaymentMethod, PaymentStatus, TransactionStatus, UserRole } from '@prisma/client';
import type { LoggerService } from '@nestjs/common';

import { BusinessRuleViolationException } from '@/common/exceptions/domain.exception';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';

import type {
  PaymentRepository,
  PaymentWithContext,
} from '../../domain/repositories/payment.repository';
import type {
  PaymentGateway,
  PaymentGatewayRegistry,
  RefundResult,
} from '../../domain/services/payment-gateway';
import type { PaymentAccessService } from './checkout.use-cases';
import { RefundPaymentUseCase } from './refund.use-cases';

const logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() } as unknown as LoggerService;

const STAFF: AuthenticatedUser = {
  id: 'admin-1',
  phone: '+923000000001',
  role: UserRole.ADMIN,
  permissions: ['payments.refund'],
  staffRestaurantId: null,
  sessionId: 'session-1',
};

function payment(overrides: Partial<PaymentWithContext> = {}): PaymentWithContext {
  return {
    id: 'payment-1',
    reference: 'PAY-260810-0001',
    orderId: 'order-1',
    userId: 'user-1',
    method: PaymentMethod.JAZZCASH,
    status: PaymentStatus.PAID,
    amount: 1000,
    refundedAmount: 0,
    gatewayName: 'jazzcash',
    gatewayTransactionId: 'T940',
    order: { id: 'order-1', orderNumber: 'ZD-260810-0007' },
    ...overrides,
  } as unknown as PaymentWithContext;
}

function build(options: {
  loaded?: PaymentWithContext;
  alreadyRefunded?: number;
  gatewayConfigured?: boolean;
  refundResult?: RefundResult;
  noGateway?: boolean;
}) {
  const loaded = options.loaded ?? payment();

  const access = {
    load: jest.fn().mockResolvedValue(loaded),
  } as unknown as jest.Mocked<PaymentAccessService>;

  const payments = {
    totalRefunded: jest.fn().mockResolvedValue(options.alreadyRefunded ?? 0),
    recordRefund: jest.fn().mockResolvedValue({ id: 'txn-1' }),
  } as unknown as jest.Mocked<PaymentRepository>;

  const gateway = {
    name: 'jazzcash',
    isConfigured: () => options.gatewayConfigured ?? true,
    refund: jest.fn().mockResolvedValue(
      options.refundResult ?? {
        accepted: true,
        gatewayRefundId: 'RF-1',
        outcome: 'PENDING',
        message: 'Refund queued',
      },
    ),
  } as unknown as PaymentGateway;

  const gateways = {
    byName: jest.fn().mockReturnValue(options.noGateway === true ? null : gateway),
  } as unknown as PaymentGatewayRegistry;

  return {
    payments,
    gateway,
    useCase: new RefundPaymentUseCase(payments, access, gateways, logger),
  };
}

describe('RefundPaymentUseCase — to the original instrument', () => {
  it('asks the gateway to return the money', async () => {
    const { useCase, gateway } = build({});

    const outcome = await useCase.execute('payment-1', { reason: 'Items missing' }, STAFF);

    expect(gateway.refund).toHaveBeenCalledWith(
      expect.objectContaining({ reference: 'PAY-260810-0001', amount: 1000 }),
    );
    expect(outcome.destination).toBe('GATEWAY');
  });

  it('records a gateway refund as pending, because the money has not moved yet', async () => {
    const { useCase, payments } = build({});

    const outcome = await useCase.execute('payment-1', { reason: 'Items missing' }, STAFF);

    expect(payments.recordRefund).toHaveBeenCalledWith(
      expect.objectContaining({ destination: 'GATEWAY', status: TransactionStatus.PENDING }),
    );
    expect(outcome.immediate).toBe(false);
  });

  it('marks it immediate when the gateway returns the money synchronously', async () => {
    const { useCase } = build({
      refundResult: {
        accepted: true,
        gatewayRefundId: 'RF-1',
        outcome: 'REFUNDED',
        message: null,
      },
    });

    const outcome = await useCase.execute('payment-1', { reason: 'Items missing' }, STAFF);

    expect(outcome.immediate).toBe(true);
  });

  it('refunds the whole remaining amount when none is given', async () => {
    const { useCase, gateway } = build({ alreadyRefunded: 250 });

    await useCase.execute('payment-1', { reason: 'Items missing' }, STAFF);

    expect(gateway.refund).toHaveBeenCalledWith(expect.objectContaining({ amount: 750 }));
  });
});

describe('RefundPaymentUseCase — falling back to the wallet', () => {
  it('credits the wallet when the gateway refuses', async () => {
    const { useCase, payments } = build({
      refundResult: {
        accepted: false,
        gatewayRefundId: null,
        outcome: 'REJECTED',
        message: 'Transaction too old to reverse',
      },
    });

    const outcome = await useCase.execute('payment-1', { reason: 'Items missing' }, STAFF);

    expect(payments.recordRefund).toHaveBeenCalledWith(
      expect.objectContaining({ destination: 'WALLET', status: TransactionStatus.SUCCESS }),
    );
    expect(outcome.destination).toBe('WALLET');
    // The customer is told why the money came back a different way.
    expect(outcome.message).toMatch(/Transaction too old to reverse/);
  });

  it('says the gateway refused even when it gives no reason', async () => {
    const { useCase } = build({
      refundResult: { accepted: false, gatewayRefundId: null, outcome: 'REJECTED', message: null },
    });

    const outcome = await useCase.execute('payment-1', { reason: 'Items missing' }, STAFF);

    // Distinct from "the gateway was never asked" — the operator needs to know
    // which of the two happened.
    expect(outcome.message).toMatch(/refused the return without giving a reason/);
  });

  it('credits the wallet when the gateway is not configured here', async () => {
    const { useCase, payments } = build({ gatewayConfigured: false });

    const outcome = await useCase.execute('payment-1', { reason: 'Items missing' }, STAFF);

    expect(payments.recordRefund).toHaveBeenCalledWith(
      expect.objectContaining({ destination: 'WALLET' }),
    );
    expect(outcome.message).toMatch(/not available for refunds on this deployment/);
  });

  it('credits the wallet for a cash order, which has no instrument to return to', async () => {
    const { useCase, payments } = build({
      loaded: payment({ method: PaymentMethod.CASH_ON_DELIVERY, gatewayName: null }),
      noGateway: true,
    });

    const outcome = await useCase.execute('payment-1', { reason: 'Items missing' }, STAFF);

    expect(payments.recordRefund).toHaveBeenCalledWith(
      expect.objectContaining({ destination: 'WALLET' }),
    );
    expect(outcome.message).toMatch(/no instrument to return to/);
  });

  it('credits the wallet when that is what was asked for', async () => {
    const { useCase, gateway, payments } = build({});

    const outcome = await useCase.execute(
      'payment-1',
      { reason: 'Items missing', destination: 'WALLET' },
      STAFF,
    );

    expect(gateway.refund).not.toHaveBeenCalled();
    expect(payments.recordRefund).toHaveBeenCalledWith(
      expect.objectContaining({ destination: 'WALLET' }),
    );
    expect(outcome.immediate).toBe(true);
  });
});

describe('RefundPaymentUseCase — guards', () => {
  it('refuses to refund more than is left', async () => {
    const { useCase, payments } = build({ alreadyRefunded: 800 });

    await expect(
      useCase.execute('payment-1', { amount: 500, reason: 'Items missing' }, STAFF),
    ).rejects.toThrow(/At most Rs. 200/);
    expect(payments.recordRefund).not.toHaveBeenCalled();
  });

  it('refuses a payment that was never collected', async () => {
    const { useCase, payments } = build({ loaded: payment({ status: PaymentStatus.PENDING }) });

    await expect(useCase.execute('payment-1', { reason: 'Items missing' }, STAFF)).rejects.toThrow(
      BusinessRuleViolationException,
    );
    expect(payments.recordRefund).not.toHaveBeenCalled();
  });

  it('refuses a payment already refunded in full', async () => {
    const { useCase } = build({
      loaded: payment({ status: PaymentStatus.REFUNDED }),
      alreadyRefunded: 1000,
    });

    await expect(useCase.execute('payment-1', { reason: 'Items missing' }, STAFF)).rejects.toThrow(
      /already been refunded in full/,
    );
  });

  it('allows the remainder of a partial refund', async () => {
    const { useCase, gateway } = build({
      loaded: payment({ status: PaymentStatus.PARTIALLY_REFUNDED }),
      alreadyRefunded: 400,
    });

    await useCase.execute('payment-1', { reason: 'Items missing' }, STAFF);

    expect(gateway.refund).toHaveBeenCalledWith(expect.objectContaining({ amount: 600 }));
  });

  it('reports the running total after the refund', async () => {
    const { useCase } = build({ alreadyRefunded: 200 });

    const outcome = await useCase.execute(
      'payment-1',
      { amount: 300, reason: 'Items missing' },
      STAFF,
    );

    expect(outcome.refunded).toBe(300);
    expect(outcome.totalRefunded).toBe(500);
  });
});
