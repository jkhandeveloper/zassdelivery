import { createHmac } from 'node:crypto';

import type { LoggerService } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';

import type { paymentsConfig } from '@/config';

import { JazzCashGateway } from './jazzcash.gateway';

type PaymentsConfig = ConfigType<typeof paymentsConfig>;

const logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() } as unknown as LoggerService;

function config(overrides: Partial<PaymentsConfig['jazzcash']> = {}): PaymentsConfig {
  return {
    publicBaseUrl: 'https://api.zassdelivery.pk',
    checkoutTtlMinutes: 15,
    jazzcash: {
      merchantId: 'MC12345',
      password: 'secret123',
      integritySalt: 'saltysalt',
      checkoutUrl: 'https://sandbox.jazzcash.com.pk/checkout',
      apiUrl: 'https://sandbox.jazzcash.com.pk/ApplicationAPI/API/PaymentInquiry/Inquire',
      ...overrides,
    },
    easypaisa: {
      storeId: '',
      hashKey: '',
      checkoutUrl: '',
      apiUrl: '',
    },
  };
}

const REQUEST = {
  reference: 'PAY-260810-0001',
  amount: 1240.5,
  currency: 'PKR',
  orderNumber: 'ZD-260810-0007',
  description: 'ZassDelivery order ZD-260810-0007',
  customerPhone: '+923001234567',
  customerEmail: 'ahmad@example.pk',
  expiresAt: new Date('2026-08-10T12:15:00.000Z'),
};

describe('JazzCashGateway.isConfigured', () => {
  it('is configured when merchant id, password and salt are all present', () => {
    expect(new JazzCashGateway(config(), logger).isConfigured()).toBe(true);
  });

  it('is unconfigured when the integrity salt is missing', () => {
    expect(new JazzCashGateway(config({ integritySalt: '' }), logger).isConfigured()).toBe(false);
  });

  it('is unconfigured when the merchant id is missing', () => {
    expect(new JazzCashGateway(config({ merchantId: '' }), logger).isConfigured()).toBe(false);
  });
});

describe('JazzCashGateway.createCheckout', () => {
  const gateway = new JazzCashGateway(config(), logger);

  it('posts to the configured checkout URL', () => {
    const instruction = gateway.createCheckout(REQUEST);

    expect(instruction.method).toBe('POST');
    expect(instruction.url).toBe('https://sandbox.jazzcash.com.pk/checkout');
  });

  it('sends the amount in paisa, not rupees', () => {
    const instruction = gateway.createCheckout(REQUEST);

    expect(instruction.fields.pp_Amount).toBe('124050');
  });

  it('sends our reference as the merchant transaction id', () => {
    const instruction = gateway.createCheckout(REQUEST);

    expect(instruction.fields.pp_TxnRefNo).toBe('PAY-260810-0001');
    expect(instruction.reference).toBe('PAY-260810-0001');
  });

  it('points the return URL at our public webhook', () => {
    const instruction = gateway.createCheckout(REQUEST);

    expect(instruction.fields.pp_ReturnURL).toBe(
      'https://api.zassdelivery.pk/api/v1/payment-webhooks/jazzcash',
    );
  });

  it('formats timestamps as yyyyMMddHHmmss', () => {
    const instruction = gateway.createCheckout(REQUEST);

    expect(instruction.fields.pp_TxnDateTime).toMatch(/^\d{14}$/);
    expect(instruction.fields.pp_TxnExpiryDateTime).toMatch(/^\d{14}$/);
  });

  it('signs the request with an uppercase hex HMAC', () => {
    const instruction = gateway.createCheckout(REQUEST);

    expect(instruction.fields.pp_SecureHash).toMatch(/^[0-9A-F]{64}$/);
  });

  it('signs the request the way JazzCash will verify it', () => {
    const fields = gateway.createCheckout(REQUEST).fields;

    // Recomputed here independently of the adapter: if the two ever disagree,
    // JazzCash rejects every request we send and the failure is at the worst
    // possible moment — the customer is already on the payment page.
    const payload = Object.keys(fields)
      .filter((key) => key !== 'pp_SecureHash')
      .sort()
      .map((key) => fields[key])
      .filter((value) => value !== '')
      .join('&');

    const expected = createHmac('sha256', 'saltysalt')
      .update(`saltysalt&${payload}`)
      .digest('hex')
      .toUpperCase();

    expect(fields.pp_SecureHash).toBe(expected);
  });

  it('signs differently under a different integrity salt', () => {
    const other = new JazzCashGateway(config({ integritySalt: 'different' }), logger);

    expect(other.createCheckout(REQUEST).fields.pp_SecureHash).not.toBe(
      gateway.createCheckout(REQUEST).fields.pp_SecureHash,
    );
  });
});

describe('JazzCashGateway.verifyCallback', () => {
  const gateway = new JazzCashGateway(config(), logger);

  /** Builds a callback signed the way JazzCash signs one. */
  function signedCallback(overrides: Record<string, string> = {}): Record<string, string> {
    const fields: Record<string, string> = {
      pp_TxnRefNo: 'PAY-260810-0001',
      pp_ResponseCode: '000',
      pp_ResponseMessage: 'Thank you for using JazzCash',
      pp_Amount: '124050',
      pp_RetreivalReferenceNo: 'T94057382',
      pp_MerchantID: 'MC12345',
      ...overrides,
    };

    // Same rule the adapter signs with: salt, then the non-empty values in key
    // order, HMAC-SHA256 keyed with the salt.
    const payload = Object.keys(fields)
      .sort()
      .map((key) => fields[key])
      .filter((value) => value !== '')
      .join('&');

    fields.pp_SecureHash = createHmac('sha256', 'saltysalt')
      .update(`saltysalt&${payload}`)
      .digest('hex')
      .toUpperCase();

    return fields;
  }

  it('accepts a correctly signed success and reports it as paid', () => {
    const result = gateway.verifyCallback(signedCallback());

    expect(result).not.toBeNull();
    expect(result?.outcome).toBe('PAID');
    expect(result?.reference).toBe('PAY-260810-0001');
    expect(result?.gatewayTransactionId).toBe('T94057382');
    expect(result?.trusted).toBe(true);
  });

  it('converts the amount back from paisa to rupees', () => {
    expect(gateway.verifyCallback(signedCallback())?.amount).toBe(1240.5);
  });

  it('rejects a callback whose amount was tampered with after signing', () => {
    const tampered = signedCallback();
    tampered.pp_Amount = '1';

    expect(gateway.verifyCallback(tampered)).toBeNull();
  });

  it('rejects a callback with no signature at all', () => {
    const unsigned = signedCallback();
    delete unsigned.pp_SecureHash;

    expect(gateway.verifyCallback(unsigned)).toBeNull();
  });

  it('rejects a callback signed with the wrong salt', () => {
    const stranger = new JazzCashGateway(config({ integritySalt: 'not-our-salt' }), logger);

    expect(stranger.verifyCallback(signedCallback())).toBeNull();
  });

  it('reports a declined payment as failed, with the provider code kept', () => {
    const result = gateway.verifyCallback(
      signedCallback({ pp_ResponseCode: '210', pp_ResponseMessage: 'Insufficient balance' }),
    );

    expect(result?.outcome).toBe('FAILED');
    expect(result?.code).toBe('210');
    expect(result?.message).toBe('Insufficient balance');
  });

  it('reports an in-progress code as pending rather than failed', () => {
    expect(gateway.verifyCallback(signedCallback({ pp_ResponseCode: '124' }))?.outcome).toBe(
      'PENDING',
    );
  });

  it('returns null for a payload with no transaction reference', () => {
    expect(gateway.verifyCallback({ pp_ResponseCode: '000' })).toBeNull();
  });

  it('keeps the whole callback for the record', () => {
    const callback = signedCallback();

    expect(gateway.verifyCallback(callback)?.raw).toEqual(callback);
  });
});

describe('JazzCashGateway when unconfigured', () => {
  const gateway = new JazzCashGateway(
    config({ merchantId: '', password: '', integritySalt: '' }),
    logger,
  );

  it('does not attempt an inquiry', async () => {
    await expect(gateway.inquire('PAY-260810-0001')).resolves.toBeNull();
  });

  it('refuses a refund instead of calling a gateway it cannot authenticate to', async () => {
    const result = await gateway.refund({
      reference: 'PAY-260810-0001',
      gatewayTransactionId: 'T94057382',
      amount: 100,
      reason: 'Missing items',
    });

    expect(result.accepted).toBe(false);
    expect(result.outcome).toBe('REJECTED');
    expect(result.message).toMatch(/not configured/);
  });
});
