import { createHmac, timingSafeEqual } from 'node:crypto';

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

/** JazzCash's success code. Everything else is a failure or a pending state. */
const SUCCESS_CODE = '000';

/** Codes that mean "the customer has not finished yet", not "it failed". */
const PENDING_CODES = ['124', '157', '199'];

/** How long to wait on the inquiry API before giving up on it. */
const INQUIRY_TIMEOUT_MS = 8000;

/** JazzCash timestamps are `yyyyMMddHHmmss` in Pakistan Standard Time. */
function formatTimestamp(date: Date): string {
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

  return `${get('year')}${get('month')}${get('day')}${get('hour')}${get('minute')}${get('second')}`;
}

/**
 * JazzCash hosted checkout.
 *
 * The customer's browser POSTs a signed form to JazzCash, pays in their mobile
 * wallet, and JazzCash posts the outcome back to `pp_ReturnURL`. Both
 * directions are authenticated with the same HMAC over the same field set, so
 * the signing rule lives in one place here and is used to sign requests and to
 * verify responses.
 */
@Injectable()
export class JazzCashGateway extends PaymentGateway {
  readonly method = PaymentMethod.JAZZCASH;
  readonly name = 'jazzcash';

  private readonly context = JazzCashGateway.name;

  constructor(
    @Inject(paymentsConfig.KEY)
    private readonly config: ConfigType<typeof paymentsConfig>,
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: LoggerService,
  ) {
    super();
  }

  isConfigured(): boolean {
    const { merchantId, password, integritySalt } = this.config.jazzcash;

    return merchantId !== '' && password !== '' && integritySalt !== '';
  }

  createCheckout(request: CheckoutRequest): CheckoutInstruction {
    const now = new Date();

    // Amounts travel in paisa as an integer string. Sending rupees would
    // silently undercharge by a factor of a hundred, which is the kind of bug
    // that only surfaces in production revenue reports.
    const fields: Record<string, string> = {
      pp_Version: '1.1',
      pp_TxnType: 'MWALLET',
      pp_Language: 'EN',
      pp_MerchantID: this.config.jazzcash.merchantId,
      pp_SubMerchantID: '',
      pp_Password: this.config.jazzcash.password,
      pp_BankID: '',
      pp_ProductID: '',
      pp_TxnRefNo: request.reference,
      pp_Amount: String(Math.round(request.amount * 100)),
      pp_TxnCurrency: request.currency,
      pp_TxnDateTime: formatTimestamp(now),
      pp_BillReference: request.orderNumber,
      pp_Description: request.description,
      pp_TxnExpiryDateTime: formatTimestamp(request.expiresAt),
      pp_ReturnURL: `${this.config.publicBaseUrl}/api/v1/payment-webhooks/jazzcash`,
      ppmpf_1: request.customerPhone,
      ppmpf_2: request.orderNumber,
      ppmpf_3: '',
      ppmpf_4: '',
      ppmpf_5: '',
    };

    fields.pp_SecureHash = this.sign(fields);

    return {
      url: this.config.jazzcash.checkoutUrl,
      method: 'POST',
      fields,
      reference: request.reference,
      expiresAt: request.expiresAt,
    };
  }

  verifyCallback(fields: Record<string, unknown>): GatewayResult | null {
    const reference = this.text(fields.pp_TxnRefNo);

    if (reference === null) {
      return null;
    }

    const presented = this.text(fields.pp_SecureHash);

    // A response signed with the wrong key is not a response from JazzCash.
    // Refusing it outright is the whole point of the hash.
    if (presented === null || !this.verifySignature(fields, presented)) {
      return null;
    }

    const code = this.text(fields.pp_ResponseCode);
    const paisa = Number(this.text(fields.pp_Amount) ?? '0');

    return {
      reference,
      gatewayTransactionId: this.text(fields.pp_RetreivalReferenceNo),
      outcome: this.outcomeFor(code),
      amount: Number.isFinite(paisa) ? Math.round(paisa) / 100 : null,
      code,
      message: this.text(fields.pp_ResponseMessage),
      trusted: true,
      raw: fields,
    };
  }

  async inquire(reference: string): Promise<GatewayResult | null> {
    if (!this.isConfigured()) {
      return null;
    }

    const payload: Record<string, string> = {
      pp_TxnRefNo: reference,
      pp_MerchantID: this.config.jazzcash.merchantId,
      pp_Password: this.config.jazzcash.password,
    };
    payload.pp_SecureHash = this.sign(payload);

    try {
      const response = await this.post(this.config.jazzcash.apiUrl, payload);

      if (response === null) {
        return null;
      }

      const code = this.text(response.pp_ResponseCode);
      const paisa = Number(this.text(response.pp_Amount) ?? '0');

      return {
        reference,
        gatewayTransactionId: this.text(response.pp_RetreivalReferenceNo),
        outcome: this.outcomeFor(code),
        amount: Number.isFinite(paisa) ? Math.round(paisa) / 100 : null,
        code,
        message: this.text(response.pp_ResponseMessage),
        // An inquiry answer came from us asking JazzCash directly over TLS, so
        // it is trustworthy without a signature on the way back.
        trusted: true,
        raw: response,
      };
    } catch (error) {
      this.logger.warn?.(
        `JazzCash inquiry for ${reference} failed: ${(error as Error).message}`,
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
        message: 'JazzCash is not configured on this deployment.',
      };
    }

    const payload: Record<string, string> = {
      pp_TxnRefNo: input.reference,
      pp_MerchantID: this.config.jazzcash.merchantId,
      pp_Password: this.config.jazzcash.password,
      pp_Amount: String(Math.round(input.amount * 100)),
      pp_TxnCurrency: 'PKR',
      pp_MerchantMPIN: '',
    };
    payload.pp_SecureHash = this.sign(payload);

    try {
      const response = await this.post(
        this.config.jazzcash.apiUrl.replace('PaymentInquiry/Inquire', 'Refund/DoRefund'),
        payload,
      );

      const code = this.text(response?.pp_ResponseCode ?? null);

      return {
        accepted: code === SUCCESS_CODE,
        gatewayRefundId: this.text(response?.pp_RetreivalReferenceNo ?? null),
        // A refund JazzCash has accepted is not a refund JazzCash has settled;
        // the money reaches the customer's wallet on their own timetable.
        outcome: code === SUCCESS_CODE ? 'PENDING' : 'REJECTED',
        message: this.text(response?.pp_ResponseMessage ?? null),
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
   * The JazzCash signature: an HMAC-SHA256, keyed with the integrity salt, over
   * the salt followed by every non-empty `pp_`/`ppmpf_` value in key order.
   *
   * Sorting is what makes it reproducible on both sides; the empty-value rule
   * is JazzCash's, and getting it wrong produces a hash that verifies in
   * testing and fails on the one request that happens to omit a field.
   */
  private sign(fields: Record<string, string>): string {
    const salt = this.config.jazzcash.integritySalt;

    const payload = Object.keys(fields)
      .filter((key) => key !== 'pp_SecureHash')
      .sort()
      .map((key) => fields[key] ?? '')
      .filter((value) => value !== '')
      .join('&');

    return createHmac('sha256', salt).update(`${salt}&${payload}`).digest('hex').toUpperCase();
  }

  private verifySignature(fields: Record<string, unknown>, presented: string): boolean {
    const stringFields: Record<string, string> = {};

    for (const [key, value] of Object.entries(fields)) {
      if (key !== 'pp_SecureHash' && (typeof value === 'string' || typeof value === 'number')) {
        stringFields[key] = String(value);
      }
    }

    const expected = this.sign(stringFields);

    // Constant-time, so a near-miss cannot be walked towards a hit by timing.
    const a = Buffer.from(expected.toUpperCase());
    const b = Buffer.from(presented.toUpperCase());

    return a.length === b.length && timingSafeEqual(a, b);
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

  private async post(url: string, payload: Record<string, string>) {
    // Bounded: a gateway that has stopped answering must not hold a request
    // thread — or a customer — until the platform's own timeout fires.
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(INQUIRY_TIMEOUT_MS),
    });

    if (!response.ok) {
      return null;
    }

    return (await response.json()) as Record<string, unknown>;
  }
}
