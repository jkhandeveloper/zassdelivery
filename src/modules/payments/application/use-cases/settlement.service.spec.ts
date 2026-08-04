import { PaymentMethod, PaymentStatus } from '@prisma/client';
import type { LoggerService } from '@nestjs/common';

import type {
  PaymentRepository,
  PaymentWithContext,
} from '../../domain/repositories/payment.repository';
import type { GatewayResult } from '../../domain/services/payment-gateway';
import { SettlementService } from './settlement.service';

const logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() } as unknown as LoggerService;

function payment(overrides: Partial<PaymentWithContext> = {}): PaymentWithContext {
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
    order: { id: 'order-1', orderNumber: 'ZD-260810-0007' },
    ...overrides,
  } as unknown as PaymentWithContext;
}

function result(overrides: Partial<GatewayResult> = {}): GatewayResult {
  return {
    reference: 'PAY-260810-0001',
    gatewayTransactionId: 'T94057382',
    outcome: 'PAID',
    amount: 1240,
    code: '000',
    message: 'Thank you',
    trusted: true,
    raw: { pp_ResponseCode: '000' },
    ...overrides,
  };
}

function repository() {
  return {
    settle: jest
      .fn()
      .mockImplementation(({ status }: { status: PaymentStatus }) =>
        Promise.resolve(payment({ status })),
      ),
    fail: jest
      .fn()
      .mockImplementation(({ status }: { status: PaymentStatus }) =>
        Promise.resolve(payment({ status })),
      ),
  } as unknown as jest.Mocked<PaymentRepository>;
}

describe('SettlementService.apply — success', () => {
  it('settles a paid result and reports the change', async () => {
    const payments = repository();
    const outcome = await new SettlementService(payments, logger).apply(payment(), result());

    expect(payments.settle).toHaveBeenCalledWith(
      expect.objectContaining({ paymentId: 'payment-1', status: PaymentStatus.PAID }),
    );
    expect(outcome.changed).toBe(true);
    expect(outcome.settled).toBe(true);
  });

  it('records the gateway transaction id and the raw payload', async () => {
    const payments = repository();
    await new SettlementService(payments, logger).apply(payment(), result());

    expect(payments.settle).toHaveBeenCalledWith(
      expect.objectContaining({
        gatewayTransactionId: 'T94057382',
        gatewayResponse: { pp_ResponseCode: '000' },
      }),
    );
  });

  it('holds an authorised payment without calling it settled', async () => {
    const payments = repository();
    const outcome = await new SettlementService(payments, logger).apply(
      payment(),
      result({ outcome: 'AUTHORIZED' }),
    );

    expect(payments.settle).toHaveBeenCalledWith(
      expect.objectContaining({ status: PaymentStatus.AUTHORIZED }),
    );
    expect(outcome.settled).toBe(false);
  });
});

describe('SettlementService.apply — idempotency', () => {
  it('does nothing to a payment that is already paid', async () => {
    const payments = repository();
    const outcome = await new SettlementService(payments, logger).apply(
      payment({ status: PaymentStatus.PAID }),
      result(),
    );

    expect(payments.settle).not.toHaveBeenCalled();
    expect(outcome.changed).toBe(false);
    expect(outcome.settled).toBe(true);
  });

  it('does nothing to a refunded payment, however the callback is redelivered', async () => {
    const payments = repository();
    const outcome = await new SettlementService(payments, logger).apply(
      payment({ status: PaymentStatus.REFUNDED }),
      result(),
    );

    expect(payments.settle).not.toHaveBeenCalled();
    expect(outcome.changed).toBe(false);
  });
});

describe('SettlementService.apply — amount checks', () => {
  it('refuses to settle when the gateway reports less than the order is worth', async () => {
    const payments = repository();
    const outcome = await new SettlementService(payments, logger).apply(
      payment(),
      result({ amount: 10 }),
    );

    expect(payments.settle).not.toHaveBeenCalled();
    expect(payments.fail).toHaveBeenCalled();
    expect(outcome.settled).toBe(false);
    expect(outcome.message).toMatch(/Rs. 10 against an expected Rs. 1240/);
  });

  it('absorbs sub-rupee rounding from the paisa round trip', async () => {
    const payments = repository();
    const outcome = await new SettlementService(payments, logger).apply(
      payment(),
      result({ amount: 1239.5 }),
    );

    expect(payments.settle).toHaveBeenCalled();
    expect(outcome.settled).toBe(true);
  });

  it('settles when the gateway does not report an amount at all', async () => {
    const payments = repository();
    await new SettlementService(payments, logger).apply(payment(), result({ amount: null }));

    expect(payments.settle).toHaveBeenCalled();
  });
});

describe('SettlementService.apply — failures', () => {
  it('fails the attempt but leaves the order open for another try', async () => {
    const payments = repository();
    const outcome = await new SettlementService(payments, logger).apply(
      payment(),
      result({ outcome: 'FAILED', code: '210', message: 'Insufficient balance' }),
    );

    expect(payments.fail).toHaveBeenCalledWith(
      expect.objectContaining({ status: PaymentStatus.FAILED, failOrder: false }),
    );
    expect(outcome.message).toBe('Insufficient balance');
  });

  it('keeps the provider code on the failure reason for support', async () => {
    const payments = repository();
    await new SettlementService(payments, logger).apply(
      payment(),
      result({ outcome: 'FAILED', code: '210', message: 'Insufficient balance' }),
    );

    expect(payments.fail).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'Insufficient balance (210)' }),
    );
  });

  it('records a cancellation distinctly from a failure', async () => {
    const payments = repository();
    await new SettlementService(payments, logger).apply(
      payment(),
      result({ outcome: 'CANCELLED', message: 'Customer cancelled' }),
    );

    expect(payments.fail).toHaveBeenCalledWith(
      expect.objectContaining({ status: PaymentStatus.CANCELLED }),
    );
  });

  it('changes nothing while the payment is still in progress', async () => {
    const payments = repository();
    const outcome = await new SettlementService(payments, logger).apply(
      payment(),
      result({ outcome: 'PENDING', message: 'Awaiting customer' }),
    );

    expect(payments.settle).not.toHaveBeenCalled();
    expect(payments.fail).not.toHaveBeenCalled();
    expect(outcome.changed).toBe(false);
  });
});
