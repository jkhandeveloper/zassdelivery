import { Injectable } from '@nestjs/common';
import { Prisma, WebhookStatus, type WebhookEvent } from '@prisma/client';

import type { PaginatedResult } from '@/common/interfaces/paginated-result.interface';
import { paginate } from '@/common/utils/pagination.util';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';

import {
  WebhookEventRepository,
  type RecordWebhookInput,
} from '../../domain/repositories/payment.repository';

@Injectable()
export class PrismaWebhookEventRepository extends WebhookEventRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async record(input: RecordWebhookInput): Promise<{ event: WebhookEvent; duplicate: boolean }> {
    try {
      const event = await this.prisma.webhookEvent.create({
        data: {
          gateway: input.gateway,
          eventId: input.eventId,
          payload: input.payload,
          signature: input.signature,
          attempts: 1,
        },
      });

      return { event, duplicate: false };
    } catch (error) {
      // The unique index on (gateway, eventId) is the replay guard. Relying on
      // it rather than on a prior lookup is what makes two simultaneous
      // redeliveries safe: the database arbitrates, not a race between reads.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const existing = await this.prisma.webhookEvent.update({
          where: {
            gateway_eventId: { gateway: input.gateway, eventId: input.eventId },
          },
          data: { attempts: { increment: 1 } },
        });

        return { event: existing, duplicate: true };
      }

      throw error;
    }
  }

  async resolve(
    id: string,
    input: { status: WebhookStatus; paymentId?: string | null; error?: string | null },
  ): Promise<WebhookEvent> {
    return this.prisma.webhookEvent.update({
      where: { id },
      data: {
        status: input.status,
        paymentId: input.paymentId ?? undefined,
        error: input.error ?? null,
        processedAt: new Date(),
      },
    });
  }

  async findById(id: string): Promise<WebhookEvent | null> {
    return this.prisma.webhookEvent.findUnique({ where: { id } });
  }

  async findMany(filter: {
    page: number;
    limit: number;
    gateway?: string;
    status?: WebhookStatus;
    paymentId?: string;
    from?: Date;
    to?: Date;
  }): Promise<PaginatedResult<WebhookEvent>> {
    const where: Prisma.WebhookEventWhereInput = {
      ...(filter.gateway && { gateway: filter.gateway }),
      ...(filter.status && { status: filter.status }),
      ...(filter.paymentId && { paymentId: filter.paymentId }),
      ...((filter.from || filter.to) && {
        receivedAt: {
          ...(filter.from && { gte: filter.from }),
          ...(filter.to && { lte: filter.to }),
        },
      }),
    };

    const [total, items] = await this.prisma.$transaction([
      this.prisma.webhookEvent.count({ where }),
      this.prisma.webhookEvent.findMany({
        where,
        orderBy: { receivedAt: 'desc' },
        skip: (filter.page - 1) * filter.limit,
        take: filter.limit,
      }),
    ]);

    return paginate(items, total, filter.page, filter.limit);
  }
}
