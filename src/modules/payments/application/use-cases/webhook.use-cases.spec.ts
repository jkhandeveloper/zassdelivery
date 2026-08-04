import { PaymentMethod, PaymentStatus, WebhookStatus } from '@prisma/client';
import type { LoggerService } from '@nestjs/common';

import type {
  PaymentRepository,
  PaymentWithContext,
  WebhookEventRepository,
} from '../../domain/repositories/payment.repository';
import type {
  GatewayResult,
  PaymentGateway,
  PaymentGatewayRegistry,
} from '../../domain/services/payment-gateway';
import type { SettlementService } from './settlement.service';
import { HandleWebhookUseCase } from './webhook.use-cases';

const logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() } as unknown as LoggerService;

const PAYLOAD = { pp_TxnRefNo: 'PAY-260810-0001', pp_ResponseCode: '000', pp_SecureHash: 'ABC' };

function payment(): PaymentWithContext {
  return {
    id: 'payment-1',
    reference: 'PAY-260810-0001',
    orderId: 'order-1',
    userId: 'user-1',
    method: PaymentMethod.JAZZCASH,
    status: PaymentStatus.PENDING,
    amount: 1240,
    gatewayName: 'jazzcash',
    order: { id: 'order-1', orderNumber: 'ZD-260810-0007' },
  } as unknown as PaymentWithContext;
}

function gatewayResult(overrides: Partial<GatewayResult> = {}): GatewayResult {
  return {
    reference: 'PAY-260810-0001',
    gatewayTransactionId: 'T940',
    outcome: 'PAID',
    amount: 1240,
    code: '000',
    message: 'Thank you',
    trusted: true,
    raw: PAYLOAD,
    ...overrides,
  };
}

function build(options: {
  verify?: GatewayResult | null;
  inquire?: GatewayResult | null;
  duplicate?: boolean;
  foundPayment?: PaymentWithContext | null;
  settleThrows?: boolean;
  knownGateway?: boolean;
}) {
  const gateway = {
    name: 'jazzcash',
    method: PaymentMethod.JAZZCASH,
    isConfigured: () => true,
    verifyCallback: jest
      .fn()
      .mockReturnValue('verify' in options ? options.verify : gatewayResult()),
    inquire: jest.fn().mockResolvedValue(options.inquire ?? null),
  } as unknown as PaymentGateway;

  const gateways = {
    byName: jest.fn().mockReturnValue(options.knownGateway === false ? null : gateway),
  } as unknown as PaymentGatewayRegistry;

  const events = {
    record: jest.fn().mockResolvedValue({
      event: { id: 'event-1' },
      duplicate: options.duplicate ?? false,
    }),
    resolve: jest.fn().mockResolvedValue({ id: 'event-1' }),
  } as unknown as jest.Mocked<WebhookEventRepository>;

  const payments = {
    findByReference: jest
      .fn()
      .mockResolvedValue('foundPayment' in options ? options.foundPayment : payment()),
  } as unknown as jest.Mocked<PaymentRepository>;

  const settlement = {
    apply: options.settleThrows
      ? jest.fn().mockRejectedValue(new Error('database unavailable'))
      : jest
          .fn()
          .mockResolvedValue({ changed: true, settled: true, message: 'Payment confirmed.' }),
  } as unknown as jest.Mocked<SettlementService>;

  return {
    events,
    payments,
    settlement,
    gateway,
    useCase: new HandleWebhookUseCase(events, payments, gateways, settlement, logger),
  };
}

describe('HandleWebhookUseCase', () => {
  it('stores the callback before doing anything with it', async () => {
    const { useCase, events } = build({});

    await useCase.execute('jazzcash', PAYLOAD);

    expect(events.record).toHaveBeenCalledWith(
      expect.objectContaining({ gateway: 'jazzcash', payload: PAYLOAD, signature: 'ABC' }),
    );
  });

  it('settles a verified success and marks the event processed', async () => {
    const { useCase, settlement, events } = build({});

    const ack = await useCase.execute('jazzcash', PAYLOAD);

    expect(settlement.apply).toHaveBeenCalled();
    expect(events.resolve).toHaveBeenCalledWith(
      'event-1',
      expect.objectContaining({ status: WebhookStatus.PROCESSED, paymentId: 'payment-1' }),
    );
    expect(ack).toEqual({
      accepted: true,
      status: WebhookStatus.PROCESSED,
      message: 'Payment confirmed.',
    });
  });

  it('acknowledges a redelivery without settling it a second time', async () => {
    const { useCase, settlement } = build({ duplicate: true });

    const ack = await useCase.execute('jazzcash', PAYLOAD);

    expect(settlement.apply).not.toHaveBeenCalled();
    // Accepted, because a gateway that does not hear a clean answer keeps
    // redelivering and eventually disables the endpoint.
    expect(ack.accepted).toBe(true);
    expect(ack.status).toBe(WebhookStatus.DUPLICATE);
  });

  it('rejects a callback whose signature does not verify, and changes nothing', async () => {
    const { useCase, settlement, events } = build({ verify: null });

    const ack = await useCase.execute('jazzcash', PAYLOAD);

    expect(settlement.apply).not.toHaveBeenCalled();
    expect(events.resolve).toHaveBeenCalledWith(
      'event-1',
      expect.objectContaining({ status: WebhookStatus.INVALID }),
    );
    expect(ack.accepted).toBe(false);
  });

  it('still stores an unverifiable callback, because it is the evidence', async () => {
    const { useCase, events } = build({ verify: null });

    await useCase.execute('jazzcash', PAYLOAD);

    expect(events.record).toHaveBeenCalled();
  });

  it('records a callback for a reference we do not know', async () => {
    const { useCase, events, settlement } = build({ foundPayment: null });

    const ack = await useCase.execute('jazzcash', PAYLOAD);

    expect(settlement.apply).not.toHaveBeenCalled();
    expect(events.resolve).toHaveBeenCalledWith(
      'event-1',
      expect.objectContaining({ status: WebhookStatus.FAILED }),
    );
    expect(ack.message).toMatch(/Unknown payment reference/);
  });

  it('rejects an unknown gateway outright', async () => {
    const { useCase, events } = build({ knownGateway: false });

    const ack = await useCase.execute('stripe', PAYLOAD);

    expect(events.record).not.toHaveBeenCalled();
    expect(ack.status).toBe(WebhookStatus.INVALID);
  });

  it('confirms an unsigned callback with the gateway before settling it', async () => {
    const { useCase, gateway, settlement } = build({
      verify: gatewayResult({ trusted: false }),
      inquire: gatewayResult(),
    });

    await useCase.execute('easypaisa', PAYLOAD);

    expect(gateway.inquire).toHaveBeenCalledWith('PAY-260810-0001');
    expect(settlement.apply).toHaveBeenCalled();
  });

  it('settles nothing when an unsigned callback cannot be confirmed', async () => {
    const { useCase, settlement, events } = build({
      verify: gatewayResult({ trusted: false }),
      inquire: null,
    });

    const ack = await useCase.execute('easypaisa', PAYLOAD);

    expect(settlement.apply).not.toHaveBeenCalled();
    expect(events.resolve).toHaveBeenCalledWith(
      'event-1',
      expect.objectContaining({ status: WebhookStatus.RECEIVED }),
    );
    // Accepted: we have the payload and will resolve it ourselves.
    expect(ack.accepted).toBe(true);
  });

  it('marks a genuine callback FAILED — not INVALID — when applying it breaks', async () => {
    const { useCase, events } = build({ settleThrows: true });

    const ack = await useCase.execute('jazzcash', PAYLOAD);

    // FAILED is the retryable state, which is what the replay endpoint acts on.
    expect(events.resolve).toHaveBeenCalledWith(
      'event-1',
      expect.objectContaining({ status: WebhookStatus.FAILED, error: 'database unavailable' }),
    );
    expect(ack.accepted).toBe(false);
  });

  it('keys deduplication on the gateway’s own event id when it sends one', async () => {
    const { useCase, events } = build({});

    await useCase.execute('jazzcash', { ...PAYLOAD, pp_RetreivalReferenceNo: 'T94057382' });

    expect(events.record).toHaveBeenCalledWith(expect.objectContaining({ eventId: 'T94057382' }));
  });

  it('falls back to reference and outcome so a later status update is not swallowed', async () => {
    const { useCase, events } = build({});

    await useCase.execute('jazzcash', PAYLOAD);

    expect(events.record).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: 'PAY-260810-0001:000' }),
    );
  });
});
