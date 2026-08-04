import { Inject, Injectable, type LoggerService } from '@nestjs/common';
import { WebhookStatus } from '@prisma/client';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import type { Prisma } from '@prisma/client';

import { ResourceNotFoundException } from '@/common/exceptions/domain.exception';
import type { PaginatedResult } from '@/common/interfaces/paginated-result.interface';

import {
  PaymentRepository,
  WebhookEventRepository,
} from '../../domain/repositories/payment.repository';
import {
  PaymentGatewayRegistry,
  type GatewayResult,
  type PaymentGateway,
} from '../../domain/services/payment-gateway';
import { toWebhookEventDto, type WebhookEventDto } from '../dto/payment-response.dto';
import type { ListWebhookEventsQueryDto } from '../dto/payment.dto';
import { SettlementService } from './settlement.service';

/** What the gateway is told, and why. */
export interface WebhookAck {
  accepted: boolean;
  status: WebhookStatus;
  message: string;
}

@Injectable()
export class HandleWebhookUseCase {
  private readonly context = HandleWebhookUseCase.name;

  constructor(
    private readonly events: WebhookEventRepository,
    private readonly payments: PaymentRepository,
    private readonly gateways: PaymentGatewayRegistry,
    private readonly settlement: SettlementService,
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: LoggerService,
  ) {}

  /**
   * Takes a callback from a payment gateway.
   *
   * The order of operations is the whole design. The payload is **stored
   * first**, before it is trusted or even understood, because the most
   * expensive failure in payments is not a bad callback — it is a callback
   * nobody can prove arrived. Everything after that is allowed to fail; the
   * evidence is already on disk.
   *
   * Then: dedupe, verify, settle. A gateway will redeliver a callback it did
   * not hear a clean answer to, so redelivery is normal traffic rather than an
   * error, and it must cost nothing.
   */
  async execute(gatewayName: string, payload: Record<string, unknown>): Promise<WebhookAck> {
    const gateway = this.gateways.byName(gatewayName);

    if (gateway === null) {
      return {
        accepted: false,
        status: WebhookStatus.INVALID,
        message: `Unknown gateway "${gatewayName}".`,
      };
    }

    const result = gateway.verifyCallback(payload);
    const eventId = this.eventIdFor(gateway, payload, result);

    const { event, duplicate } = await this.events.record({
      gateway: gateway.name,
      eventId,
      payload: payload as Prisma.InputJsonValue,
      signature: this.signatureFrom(payload),
    });

    if (duplicate) {
      // Already applied. Answering cheerfully is what stops the gateway
      // escalating a delivery it has, in fact, made successfully.
      return {
        accepted: true,
        status: WebhookStatus.DUPLICATE,
        message: 'Already processed.',
      };
    }

    if (result === null) {
      await this.events.resolve(event.id, {
        status: WebhookStatus.INVALID,
        error: 'Signature did not verify, or the payload could not be read.',
      });

      this.logger.warn?.(
        `Rejected an unverifiable ${gateway.name} callback (event ${event.id})`,
        this.context,
      );

      return {
        accepted: false,
        status: WebhookStatus.INVALID,
        message: 'Signature verification failed.',
      };
    }

    const payment = await this.payments.findByReference(result.reference);

    if (payment === null) {
      await this.events.resolve(event.id, {
        status: WebhookStatus.FAILED,
        error: `No payment found for reference ${result.reference}.`,
      });

      return {
        accepted: false,
        status: WebhookStatus.FAILED,
        message: 'Unknown payment reference.',
      };
    }

    // An unsigned callback is a claim, not evidence. Before acting on one, ask
    // the gateway directly over TLS — the only channel where the answer is
    // known to have come from them.
    const trusted = result.trusted ? result : await gateway.inquire(result.reference);

    if (trusted === null) {
      await this.events.resolve(event.id, {
        status: WebhookStatus.RECEIVED,
        paymentId: payment.id,
        error: 'Unsigned callback and the gateway could not be reached to confirm it.',
      });

      return {
        accepted: true,
        status: WebhookStatus.RECEIVED,
        message: 'Stored for confirmation.',
      };
    }

    try {
      const outcome = await this.settlement.apply(payment, trusted);

      await this.events.resolve(event.id, {
        status: WebhookStatus.PROCESSED,
        paymentId: payment.id,
      });

      return { accepted: true, status: WebhookStatus.PROCESSED, message: outcome.message };
    } catch (error) {
      // FAILED rather than INVALID: the callback was genuine and applying it is
      // worth retrying, which is exactly what the replay endpoint is for.
      await this.events.resolve(event.id, {
        status: WebhookStatus.FAILED,
        paymentId: payment.id,
        error: (error as Error).message,
      });

      this.logger.error?.(
        `Failed to apply ${gateway.name} callback for ${result.reference}: ${(error as Error).message}`,
        (error as Error).stack,
        this.context,
      );

      return {
        accepted: false,
        status: WebhookStatus.FAILED,
        message: 'The callback was accepted but could not be applied.',
      };
    }
  }

  /**
   * The key a redelivery is recognised by.
   *
   * The gateway's own event id when it sends one; otherwise the merchant
   * reference paired with the outcome — a provider that reports "pending" and
   * later "paid" for one payment has sent two events, and collapsing them onto
   * the reference alone would swallow the second.
   */
  private eventIdFor(
    gateway: PaymentGateway,
    payload: Record<string, unknown>,
    result: GatewayResult | null,
  ): string {
    const explicit = payload.eventId ?? payload.notificationId ?? payload.pp_RetreivalReferenceNo;

    if (typeof explicit === 'string' && explicit.trim() !== '') {
      return explicit.trim();
    }

    if (result !== null) {
      return `${result.reference}:${result.code ?? result.outcome}`;
    }

    // Unreadable payloads still get stored, keyed on their arrival, because an
    // unreadable callback is precisely the thing an operator will need to look
    // at later.
    return `${gateway.name}:unparseable:${Date.now()}`;
  }

  private signatureFrom(payload: Record<string, unknown>): string | null {
    const candidate = payload.pp_SecureHash ?? payload.merchantHashedReq ?? payload.signature;

    return typeof candidate === 'string' ? candidate.slice(0, 255) : null;
  }
}

@Injectable()
export class ReplayWebhookUseCase {
  constructor(
    private readonly events: WebhookEventRepository,
    private readonly payments: PaymentRepository,
    private readonly gateways: PaymentGatewayRegistry,
    private readonly settlement: SettlementService,
  ) {}

  /**
   * Re-applies a stored callback.
   *
   * The reason the raw payload is kept: when settlement failed for a reason
   * that has since been fixed, an operator can replay the gateway's original
   * statement rather than reconstructing what it must have said.
   */
  async execute(eventId: string): Promise<WebhookEventDto> {
    const event = await this.events.findById(eventId);

    if (!event) {
      throw new ResourceNotFoundException('Webhook event', eventId);
    }

    const gateway = this.gateways.byName(event.gateway);
    const payload = (event.payload ?? {}) as Record<string, unknown>;

    if (gateway === null) {
      return toWebhookEventDto(
        await this.events.resolve(event.id, {
          status: WebhookStatus.INVALID,
          error: `Gateway "${event.gateway}" is no longer configured.`,
        }),
      );
    }

    const result = gateway.verifyCallback(payload);

    if (result === null) {
      return toWebhookEventDto(
        await this.events.resolve(event.id, {
          status: WebhookStatus.INVALID,
          error: 'Signature did not verify on replay.',
        }),
      );
    }

    const payment = await this.payments.findByReference(result.reference);

    if (payment === null) {
      return toWebhookEventDto(
        await this.events.resolve(event.id, {
          status: WebhookStatus.FAILED,
          error: `No payment found for reference ${result.reference}.`,
        }),
      );
    }

    const trusted = result.trusted ? result : await gateway.inquire(result.reference);

    if (trusted === null) {
      return toWebhookEventDto(
        await this.events.resolve(event.id, {
          status: WebhookStatus.RECEIVED,
          paymentId: payment.id,
          error: 'Still cannot confirm this callback with the gateway.',
        }),
      );
    }

    await this.settlement.apply(payment, trusted);

    return toWebhookEventDto(
      await this.events.resolve(event.id, {
        status: WebhookStatus.PROCESSED,
        paymentId: payment.id,
      }),
      { includePayload: true },
    );
  }
}

@Injectable()
export class ListWebhookEventsUseCase {
  constructor(private readonly events: WebhookEventRepository) {}

  async execute(query: ListWebhookEventsQueryDto): Promise<PaginatedResult<WebhookEventDto>> {
    const result = await this.events.findMany({
      page: query.page,
      limit: query.limit,
      gateway: query.gateway,
      status: query.status,
      paymentId: query.paymentId,
      from: query.from,
      to: query.to,
    });

    return {
      items: result.items.map((event) => toWebhookEventDto(event, { includePayload: true })),
      meta: result.meta,
    };
  }
}
