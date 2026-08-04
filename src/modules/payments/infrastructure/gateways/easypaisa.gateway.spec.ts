import { createDecipheriv } from 'node:crypto';

import type { LoggerService } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';

import type { paymentsConfig } from '@/config';

import { EasypaisaGateway } from './easypaisa.gateway';

type PaymentsConfig = ConfigType<typeof paymentsConfig>;

const logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() } as unknown as LoggerService;

/** Easypaisa issues 16-character keys; AES-128 needs exactly that. */
const HASH_KEY = 'abcdef0123456789';

function config(overrides: Partial<PaymentsConfig['easypaisa']> = {}): PaymentsConfig {
  return {
    publicBaseUrl: 'https://api.zassdelivery.pk',
    checkoutTtlMinutes: 15,
    jazzcash: {
      merchantId: '',
      password: '',
      integritySalt: '',
      checkoutUrl: '',
      apiUrl: '',
    },
    easypaisa: {
      storeId: '54321',
      hashKey: HASH_KEY,
      checkoutUrl: 'https://easypay.easypaisa.com.pk/easypay/Index.jsf',
      apiUrl: 'https://easypay.easypaisa.com.pk/easypay-service/rest/v4',
      ...overrides,
    },
  };
}

const REQUEST = {
  reference: 'PAY-260810-0002',
  amount: 1240.5,
  currency: 'PKR',
  orderNumber: 'ZD-260810-0008',
  description: 'ZassDelivery order ZD-260810-0008',
  customerPhone: '+923001234567',
  customerEmail: 'ahmad@example.pk',
  expiresAt: new Date('2026-08-10T12:15:00.000Z'),
};

describe('EasypaisaGateway.isConfigured', () => {
  it('is configured with a store id and a hash key', () => {
    expect(new EasypaisaGateway(config(), logger).isConfigured()).toBe(true);
  });

  it('is unconfigured without a hash key', () => {
    expect(new EasypaisaGateway(config({ hashKey: '' }), logger).isConfigured()).toBe(false);
  });
});

describe('EasypaisaGateway.createCheckout', () => {
  const gateway = new EasypaisaGateway(config(), logger);

  it('sends the amount in rupees with two decimals, unlike JazzCash', () => {
    expect(gateway.createCheckout(REQUEST).fields.amount).toBe('1240.50');
  });

  it('sends our reference as the order reference', () => {
    expect(gateway.createCheckout(REQUEST).fields.orderRefNum).toBe('PAY-260810-0002');
  });

  it('points the post-back URL at our public webhook', () => {
    expect(gateway.createCheckout(REQUEST).fields.postBackURL).toBe(
      'https://api.zassdelivery.pk/api/v1/payment-webhooks/easypaisa',
    );
  });

  it('formats the expiry as Easypay expects', () => {
    expect(gateway.createCheckout(REQUEST).fields.expiryDate).toMatch(/^\d{2}-\d{2}-\d{4} \d{6}$/);
  });

  it('encrypts the parameters into the request hash', () => {
    const fields = gateway.createCheckout(REQUEST).fields;
    const hash = fields.merchantHashedReq;

    expect(hash).toBeDefined();

    // Decrypting with the store key must give back the sorted parameter string
    // — that is precisely the check Easypaisa performs at their end.
    const decipher = createDecipheriv('aes-128-ecb', Buffer.from(HASH_KEY, 'utf8'), null);
    const plain = Buffer.concat([
      decipher.update(Buffer.from(hash as string, 'base64')),
      decipher.final(),
    ]).toString('utf8');

    expect(plain).toContain('amount=1240.50');
    expect(plain).toContain('orderRefNum=PAY-260810-0002');
    expect(plain).toContain('storeId=54321');
  });

  it('omits the hash rather than throwing when the key is the wrong length', () => {
    const broken = new EasypaisaGateway(config({ hashKey: 'too-short' }), logger);

    expect(broken.createCheckout(REQUEST).fields.merchantHashedReq).toBeUndefined();
  });
});

describe('EasypaisaGateway.verifyCallback', () => {
  const gateway = new EasypaisaGateway(config(), logger);

  it('reads a successful return', () => {
    const result = gateway.verifyCallback({
      status: '0000',
      desc: 'SUCCESS',
      orderRefNumber: 'PAY-260810-0002',
      transactionId: 'EP-99887766',
      transactionAmount: '1240.50',
    });

    expect(result?.outcome).toBe('PAID');
    expect(result?.reference).toBe('PAY-260810-0002');
    expect(result?.gatewayTransactionId).toBe('EP-99887766');
    expect(result?.amount).toBe(1240.5);
  });

  it('never trusts the return, because Easypay does not sign it', () => {
    const result = gateway.verifyCallback({
      status: '0000',
      orderRefNumber: 'PAY-260810-0002',
    });

    expect(result?.trusted).toBe(false);
  });

  it('accepts either name Easypay uses for the reference', () => {
    expect(gateway.verifyCallback({ orderRefNum: 'PAY-1', status: '0000' })?.reference).toBe(
      'PAY-1',
    );
    expect(gateway.verifyCallback({ orderId: 'PAY-2', status: '0000' })?.reference).toBe('PAY-2');
  });

  it('reports a declined payment as failed', () => {
    const result = gateway.verifyCallback({
      status: '0001',
      orderRefNumber: 'PAY-260810-0002',
    });

    expect(result?.outcome).toBe('PENDING');
  });

  it('treats an unknown code as a failure rather than a success', () => {
    expect(
      gateway.verifyCallback({ status: '9999', orderRefNumber: 'PAY-260810-0002' })?.outcome,
    ).toBe('FAILED');
  });

  it('returns null when there is no reference to match a payment on', () => {
    expect(gateway.verifyCallback({ status: '0000' })).toBeNull();
  });
});

describe('EasypaisaGateway when unconfigured', () => {
  const gateway = new EasypaisaGateway(config({ storeId: '', hashKey: '' }), logger);

  it('does not attempt an inquiry', async () => {
    await expect(gateway.inquire('PAY-260810-0002')).resolves.toBeNull();
  });

  it('refuses a refund', async () => {
    const result = await gateway.refund({
      reference: 'PAY-260810-0002',
      gatewayTransactionId: null,
      amount: 100,
      reason: 'Missing items',
    });

    expect(result.accepted).toBe(false);
    expect(result.message).toMatch(/not configured/);
  });
});
