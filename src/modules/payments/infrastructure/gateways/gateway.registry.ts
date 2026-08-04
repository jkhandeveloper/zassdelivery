import { Injectable } from '@nestjs/common';
import type { PaymentMethod } from '@prisma/client';

import { PaymentGatewayRegistry, type PaymentGateway } from '../../domain/services/payment-gateway';
import { EasypaisaGateway } from './easypaisa.gateway';
import { JazzCashGateway } from './jazzcash.gateway';

/**
 * The gateways this deployment knows about.
 *
 * Adding a provider is a new adapter plus a constructor argument here — no
 * use-case, controller or DTO changes, because everything upstream is written
 * against `PaymentGateway` rather than against a provider.
 */
@Injectable()
export class GatewayRegistry extends PaymentGatewayRegistry {
  private readonly gateways: PaymentGateway[];

  constructor(jazzcash: JazzCashGateway, easypaisa: EasypaisaGateway) {
    super();
    this.gateways = [jazzcash, easypaisa];
  }

  forMethod(method: PaymentMethod): PaymentGateway | null {
    return this.gateways.find((gateway) => gateway.method === method) ?? null;
  }

  byName(name: string): PaymentGateway | null {
    const wanted = name.trim().toLowerCase();

    return this.gateways.find((gateway) => gateway.name === wanted) ?? null;
  }

  all(): PaymentGateway[] {
    return [...this.gateways];
  }
}
