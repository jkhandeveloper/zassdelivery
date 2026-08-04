import type { PaymentMethod } from '@prisma/client';

/** What the client needs in order to send the customer to the gateway. */
export interface CheckoutInstruction {
  /** Where the browser is sent. Both supported gateways are POST-form hosted pages. */
  url: string;
  method: 'POST' | 'GET' | 'REDIRECT';
  /** Form fields to post, already signed. Rendered as hidden inputs by the client. */
  fields: Record<string, string>;
  /** Our merchant reference, echoed back on every callback. */
  reference: string;
  expiresAt: Date;
}

/** The outcome a gateway reported, normalised across providers. */
export interface GatewayResult {
  /** Our reference, recovered from the callback. */
  reference: string;
  /** The gateway's own transaction id, once it has one. */
  gatewayTransactionId: string | null;
  outcome: 'PAID' | 'AUTHORIZED' | 'FAILED' | 'PENDING' | 'CANCELLED';
  /** Amount the gateway says it moved, in rupees. */
  amount: number | null;
  /** Provider response code, kept verbatim for support and reconciliation. */
  code: string | null;
  message: string | null;
  /**
   * Whether the payload proved it came from the gateway.
   *
   * Not every provider signs its browser return, so this is the difference
   * between "the gateway told us" and "someone told us". Only a trusted result
   * may settle a payment directly; an untrusted one has to be confirmed with
   * `inquire()` before a rupee moves.
   */
  trusted: boolean;
  /** The whole callback, stored as received. */
  raw: Record<string, unknown>;
}

export interface RefundResult {
  accepted: boolean;
  /** The gateway's reference for the refund, when it issues one synchronously. */
  gatewayRefundId: string | null;
  /** Refunds are frequently asynchronous; PENDING means "asked, not yet done". */
  outcome: 'REFUNDED' | 'PENDING' | 'REJECTED';
  message: string | null;
}

export interface CheckoutRequest {
  reference: string;
  amount: number;
  currency: string;
  orderNumber: string;
  description: string;
  customerPhone: string;
  customerEmail: string | null;
  expiresAt: Date;
}

/**
 * A payment provider, reduced to the four things the platform actually needs.
 *
 * Declared in the domain so the checkout, verification and webhook flows are
 * written once against this shape rather than once per provider. Adding a third
 * gateway is a new adapter and a registry entry; no use-case changes.
 *
 * Note what is *not* here: nothing that talks about redirect pages, HTML forms
 * or provider-specific field names. Those are the adapter's business, and
 * keeping them out is what lets the flows be tested without a gateway.
 */
export abstract class PaymentGateway {
  /** The payment method this adapter serves. */
  abstract readonly method: PaymentMethod;

  /** Short stable name recorded on payments and webhook events. */
  abstract readonly name: string;

  /**
   * Whether credentials are present.
   *
   * Checked at checkout so an unconfigured gateway is reported as unavailable
   * up front, rather than producing a signed-with-nothing request the provider
   * rejects after the customer has already committed to paying.
   */
  abstract isConfigured(): boolean;

  /** Builds the signed request that sends the customer to the hosted page. */
  abstract createCheckout(request: CheckoutRequest): CheckoutInstruction;

  /**
   * Verifies a callback's signature and normalises it.
   *
   * Returns null when the payload is unreadable, or when it carries a signature
   * that does not verify — a callback signed with the wrong key is an
   * instruction from a stranger, and the caller records it as INVALID without
   * changing anything. A readable payload that carries no signature at all
   * comes back with `trusted: false`, which means "confirm before believing".
   */
  abstract verifyCallback(fields: Record<string, unknown>): GatewayResult | null;

  /**
   * Asks the provider what actually happened, for when a callback never
   * arrived. Returns null if the provider cannot be reached or has no record.
   */
  abstract inquire(reference: string): Promise<GatewayResult | null>;

  /** Asks the provider to return money to the original instrument. */
  abstract refund(input: {
    reference: string;
    gatewayTransactionId: string | null;
    amount: number;
    reason: string;
  }): Promise<RefundResult>;
}

/**
 * Registry of the configured gateways, so the flows can ask for "whatever
 * handles JAZZCASH" without importing the adapters.
 */
export abstract class PaymentGatewayRegistry {
  abstract forMethod(method: PaymentMethod): PaymentGateway | null;
  abstract byName(name: string): PaymentGateway | null;
  /** Every gateway, configured or not — the checkout screen lists all of them. */
  abstract all(): PaymentGateway[];
}
