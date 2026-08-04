import { createCipheriv } from 'node:crypto';

import { Inject, Injectable, type LoggerService } from '@nestjs/common';
import { PaymentMethod } from '@prisma/client';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import type { ConfigType } from '@nestjs/config';

import { paymentsConfig } from '@/config';

import {
  PaymentGateway,
  type CheckoutInstruction,
  type CheckoutRequest,
  type GatewayResult,
  type RefundResult,
} from '../../domain/services/payment-gateway';

/** Easypaisa's success code on both the browser return and the inquiry API. */
const SUCCESS_CODE = '0000';

/** Codes meaning the customer has not finished, rather than has failed. */
const PENDING_CODES = ['0001', '0002'];

const INQUIRY_TIMEOUT_MS = 8000;

/** Easypay expects `dd-MM-yyyy HHmmss` in Pakistan Standard Time. */
function formatExpiry(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Karachi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);

  const get = (type: string): string => parts.find((part) => part.type === type)?.value ?? '00';

  return `${get('day')}-${get('month')}-${get('year')} ${get('hour')}${get('minute')}${get('second')}`;
}

/**
 * Easypaisa hosted checkout (Easypay).
 *
 * The request is authenticated with an AES-128-ECB encryption of the parameter
 * string rather than an HMAC — Easypaisa's scheme, not a choice made here.
 *
 * The browser return is **not** signed: Easypay redirects with a plain query
 * string that anybody could forge by typing it into the address bar. That is
 * why `verifyCallback` marks its result untrusted, and why settling an
 * Easypaisa payment always goes through `inquire()` — asking Easypaisa
 * ourselves over TLS is the only statement about this payment worth acting on.
 */
@Injectable()
export class EasypaisaGateway extends PaymentGateway {
  readonly method = PaymentMethod.EASYPAISA;
  readonly name = 'easypaisa';

  private readonly context = EasypaisaGateway.name;

  constructor(
    @Inject(paymentsConfig.KEY)
    private readonly config: ConfigType<typeof paymentsConfig>,
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: LoggerService,
  ) {
    super();
  }

  isConfigured(): boolean {
    const { storeId, hashKey } = this.config.easypaisa;

    return storeId !== '' && hashKey !== '';
  }

  createCheckout(request: CheckoutRequest): CheckoutInstruction {
    // Easypay takes rupees with two decimals, unlike JazzCash's paisa.
    const fields: Record<string, string> = {
      amount: request.amount.toFixed(2),
      autoRedirect: '1',
      emailAddr: request.customerEmail ?? '',
      expiryDate: formatExpiry(request.expiresAt),
      mobileNum: request.customerPhone,
      orderRefNum: request.reference,
      paymentMethod: 'MA_PAYMENT_METHOD',
      postBackURL: `${this.config.publicBaseUrl}/api/v1/payment-webhooks/easypaisa`,
      storeId: this.config.easypaisa.storeId,
    };

    const hashed = this.hash(fields);

    return {
      url: this.config.easypaisa.checkoutUrl,
      method: 'POST',
      fields: hashed === null ? fields : { ...fields, merchantHashedReq: hashed },
      reference: request.reference,
      expiresAt: request.expiresAt,
    };
  }

  verifyCallback(fields: Record<string, unknown>): GatewayResult | null {
    // Easypay names this field differently on the return leg and the
    // server-to-server leg; accept both rather than losing a real payment to a
    // naming difference.
    const reference =
      this.text(fields.orderRefNumber) ??
      this.text(fields.orderRefNum) ??
      this.text(fields.orderId);

    if (reference === null) {
      return null;
    }

    const code = this.text(fields.status) ?? this.text(fields.responseCode);
    const amount = Number(this.text(fields.transactionAmount) ?? this.text(fields.amount) ?? '');

    return {
      reference,
      gatewayTransactionId:
        this.text(fields.transactionId) ?? this.text(fields.paymentToken) ?? null,
      outcome: this.outcomeFor(code),
      amount: Number.isFinite(amount) ? amount : null,
      code,
      message: this.text(fields.desc) ?? this.text(fields.responseDesc),
      // Unsigned by design. Nothing settles on this alone.
      trusted: false,
      raw: fields,
    };
  }

  async inquire(reference: string): Promise<GatewayResult | null> {
    if (!this.isConfigured()) {
      return null;
    }

    try {
      const url = `${this.config.easypaisa.apiUrl}/inquire-transaction`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Credentials: this.config.easypaisa.hashKey,
        },
        body: JSON.stringify({
          orderId: reference,
          storeId: this.config.easypaisa.storeId,
          accountNum: '',
        }),
        signal: AbortSignal.timeout(INQUIRY_TIMEOUT_MS),
      });

      if (!response.ok) {
        return null;
      }

      const body = (await response.json()) as Record<string, unknown>;
      const code = this.text(body.responseCode);
      const amount = Number(this.text(body.transactionAmount) ?? '');

      return {
        reference,
        gatewayTransactionId: this.text(body.transactionId),
        outcome: this.outcomeFor(code),
        amount: Number.isFinite(amount) ? amount : null,
        code,
        message: this.text(body.responseDesc),
        trusted: true,
        raw: body,
      };
    } catch (error) {
      this.logger.warn?.(
        `Easypaisa inquiry for ${reference} failed: ${(error as Error).message}`,
        this.context,
      );

      return null;
    }
  }

  async refund(input: {
    reference: string;
    gatewayTransactionId: string | null;
    amount: number;
    reason: string;
  }): Promise<RefundResult> {
    if (!this.isConfigured()) {
      return {
        accepted: false,
        gatewayRefundId: null,
        outcome: 'REJECTED',
        message: 'Easypaisa is not configured on this deployment.',
      };
    }

    try {
      const response = await fetch(`${this.config.easypaisa.apiUrl}/reverse-transaction`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Credentials: this.config.easypaisa.hashKey,
        },
        body: JSON.stringify({
          orderId: input.reference,
          storeId: this.config.easypaisa.storeId,
          transactionAmount: input.amount.toFixed(2),
          transactionId: input.gatewayTransactionId ?? '',
          msisdn: '',
        }),
        signal: AbortSignal.timeout(INQUIRY_TIMEOUT_MS),
      });

      const body = (await response.json()) as Record<string, unknown>;
      const code = this.text(body.responseCode);

      return {
        accepted: code === SUCCESS_CODE,
        gatewayRefundId: this.text(body.transactionId),
        outcome: code === SUCCESS_CODE ? 'PENDING' : 'REJECTED',
        message: this.text(body.responseDesc),
      };
    } catch (error) {
      return {
        accepted: false,
        gatewayRefundId: null,
        outcome: 'REJECTED',
        message: (error as Error).message,
      };
    }
  }

  /**
   * Easypaisa's request hash: the parameters in key order as `key=value&`,
   * encrypted with AES-128-ECB under the store's hash key and base64-encoded.
   *
   * Returns null when the key is missing or the wrong length rather than
   * throwing — an unconfigured gateway is a state the checkout flow already
   * handles, and a crash inside a signing routine is a much worse way to learn
   * about it.
   */
  private hash(fields: Record<string, string>): string | null {
    const key = this.config.easypaisa.hashKey;

    if (key.length !== 16 && key.length !== 24 && key.length !== 32) {
      return null;
    }

    const payload = Object.keys(fields)
      .sort()
      .filter((name) => fields[name] !== '')
      .map((name) => `${name}=${fields[name]}`)
      .join('&');

    const algorithm = `aes-${key.length * 8}-ecb` as const;
    const cipher = createCipheriv(algorithm, Buffer.from(key, 'utf8'), null);

    return Buffer.concat([cipher.update(payload, 'utf8'), cipher.final()]).toString('base64');
  }

  private outcomeFor(code: string | null): GatewayResult['outcome'] {
    if (code === SUCCESS_CODE) {
      return 'PAID';
    }

    if (code !== null && PENDING_CODES.includes(code)) {
      return 'PENDING';
    }

    return 'FAILED';
  }

  private text(value: unknown): string | null {
    if (typeof value === 'string') {
      return value.trim() === '' ? null : value.trim();
    }

    return typeof value === 'number' ? String(value) : null;
  }
}
