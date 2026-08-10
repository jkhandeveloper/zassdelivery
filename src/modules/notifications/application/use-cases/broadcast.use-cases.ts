import { Inject, Injectable, type LoggerService } from '@nestjs/common';
import {
  BroadcastAudience,
  BroadcastStatus,
  NotificationChannel,
  NotificationType,
  type Broadcast,
} from '@prisma/client';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import type { ConfigType } from '@nestjs/config';
import type { Prisma } from '@prisma/client';

import {
  BusinessRuleViolationException,
  ResourceNotFoundException,
} from '@/common/exceptions/domain.exception';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import type { PaginatedResult } from '@/common/interfaces/paginated-result.interface';
import { notificationsConfig } from '@/config';

import { BroadcastRepository } from '../../domain/repositories/notification.repository';
import {
  toBroadcastDto,
  type BroadcastDto,
  type BroadcastPreviewDto,
  type SendResultDto,
} from '../dto/notification-response.dto';
import type {
  CreateBroadcastDto,
  ListBroadcastsQueryDto,
  SendNotificationDto,
  UpdateBroadcastDto,
} from '../dto/notification.dto';
import { PROMO_QUIET_HOURS } from './history.use-cases';
import { NotifyService } from './notify.service';

/** Statuses from which a campaign can still be edited or cancelled. */
const EDITABLE: BroadcastStatus[] = [BroadcastStatus.DRAFT, BroadcastStatus.SCHEDULED];

function describeAudience(
  broadcast: Pick<Broadcast, 'audience' | 'roleFilter' | 'zoneId' | 'userIds'>,
): string {
  switch (broadcast.audience) {
    case BroadcastAudience.ROLE:
      return `Everyone with the ${broadcast.roleFilter ?? 'unspecified'} role`;
    case BroadcastAudience.ZONE:
      return 'Everyone with a saved address in this zone';
    case BroadcastAudience.ACTIVE_CUSTOMERS:
      return 'Customers who have placed at least one order';
    case BroadcastAudience.USER_IDS:
      return `${broadcast.userIds.length} named recipient(s)`;
    default:
      return 'All active accounts';
  }
}

@Injectable()
export class CreateBroadcastUseCase {
  constructor(private readonly broadcasts: BroadcastRepository) {}

  /**
   * Composes a campaign without sending it.
   *
   * Draft-first on purpose. A broadcast is the one action in this platform that
   * reaches every customer at once, and the difference between a good campaign
   * and an incident is usually a proofread — so the default is to save it and
   * make sending a separate, deliberate act.
   */
  async execute(dto: CreateBroadcastDto, actor: AuthenticatedUser): Promise<BroadcastDto> {
    assertAudienceIsComplete(dto);

    if (dto.scheduledFor !== undefined && dto.scheduledFor <= new Date()) {
      throw new BusinessRuleViolationException('A scheduled time must be in the future.');
    }

    const broadcast = await this.broadcasts.create({
      title: dto.title,
      body: dto.body,
      type: dto.type ?? NotificationType.PROMOTION,
      data: (dto.data ?? null) as Prisma.InputJsonValue | null,
      audience: dto.audience,
      roleFilter: dto.roleFilter ?? null,
      zoneId: dto.zoneId ?? null,
      userIds: dto.userIds ?? [],
      channels: dto.channels ?? [NotificationChannel.IN_APP, NotificationChannel.PUSH],
      scheduledFor: dto.scheduledFor ?? null,
      createdById: actor.id,
    });

    return toBroadcastDto(broadcast);
  }
}

@Injectable()
export class UpdateBroadcastUseCase {
  constructor(private readonly broadcasts: BroadcastRepository) {}

  async execute(id: string, dto: UpdateBroadcastDto): Promise<BroadcastDto> {
    const existing = await load(this.broadcasts, id);

    if (!EDITABLE.includes(existing.status)) {
      throw new BusinessRuleViolationException(
        `This campaign is ${existing.status.toLowerCase()} and can no longer be edited.`,
      );
    }

    if (dto.audience !== undefined) {
      assertAudienceIsComplete(dto);
    }

    return toBroadcastDto(
      await this.broadcasts.update(id, {
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.body !== undefined && { body: dto.body }),
        ...(dto.type !== undefined && { type: dto.type }),
        ...(dto.data !== undefined && { data: dto.data as Prisma.InputJsonValue }),
        ...(dto.audience !== undefined && { audience: dto.audience }),
        ...(dto.roleFilter !== undefined && { roleFilter: dto.roleFilter }),
        ...(dto.zoneId !== undefined && { zoneId: dto.zoneId }),
        ...(dto.userIds !== undefined && { userIds: dto.userIds }),
        ...(dto.channels !== undefined && { channels: dto.channels }),
        ...(dto.scheduledFor !== undefined && { scheduledFor: dto.scheduledFor }),
      }),
    );
  }
}

@Injectable()
export class ListBroadcastsUseCase {
  constructor(private readonly broadcasts: BroadcastRepository) {}

  async execute(query: ListBroadcastsQueryDto): Promise<PaginatedResult<BroadcastDto>> {
    const result = await this.broadcasts.findMany({
      page: query.page,
      limit: query.limit,
      status: query.status,
      from: query.from,
      to: query.to,
    });

    return { items: result.items.map(toBroadcastDto), meta: result.meta };
  }
}

@Injectable()
export class GetBroadcastUseCase {
  constructor(private readonly broadcasts: BroadcastRepository) {}

  async execute(id: string): Promise<BroadcastDto> {
    return toBroadcastDto(await load(this.broadcasts, id));
  }
}

@Injectable()
export class PreviewAudienceUseCase {
  constructor(private readonly broadcasts: BroadcastRepository) {}

  /**
   * How many people this would actually reach.
   *
   * Worth its own endpoint: nobody should discover the size of an audience by
   * sending to it, and "ALL" in a city of forty thousand accounts reads exactly
   * the same in a form as "ROLE=VENDOR_STAFF" does.
   */
  async execute(id: string): Promise<BroadcastPreviewDto> {
    const broadcast = await load(this.broadcasts, id);

    return {
      recipientCount: await this.broadcasts.countAudience(broadcast),
      audience: broadcast.audience,
      description: describeAudience(broadcast),
    };
  }
}

@Injectable()
export class SendBroadcastUseCase {
  private readonly context = SendBroadcastUseCase.name;

  constructor(
    private readonly broadcasts: BroadcastRepository,
    private readonly notify: NotifyService,
    @Inject(notificationsConfig.KEY)
    private readonly config: ConfigType<typeof notificationsConfig>,
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: LoggerService,
  ) {}

  async execute(id: string): Promise<SendResultDto> {
    const broadcast = await load(this.broadcasts, id);

    if (!EDITABLE.includes(broadcast.status)) {
      throw new BusinessRuleViolationException(
        broadcast.status === BroadcastStatus.SENT
          ? 'This campaign has already been sent. Duplicate it rather than sending it twice.'
          : `This campaign is ${broadcast.status.toLowerCase()} and cannot be sent.`,
      );
    }

    return this.deliver(broadcast);
  }

  /**
   * Fans the campaign out, a page of recipients at a time.
   *
   * Paged by keyset rather than loaded whole: "everyone" is a number that only
   * grows, and a campaign that reads the entire user table into memory works
   * right up until the day it matters. Counts are written back as each batch
   * lands, so a long send shows progress rather than a number that appears at
   * the end.
   */
  async deliver(broadcast: Broadcast): Promise<SendResultDto> {
    await this.broadcasts.setStatus(broadcast.id, BroadcastStatus.SENDING, {
      counts: { recipientCount: 0, deliveredCount: 0, failedCount: 0, skippedCount: 0 },
    });

    let cursor: string | null = null;
    let delivered = 0;
    let failed = 0;
    let skipped = 0;
    let recipients = 0;

    try {
      for (;;) {
        const batch: Array<{ id: string }> = await this.broadcasts.resolveAudience(
          broadcast,
          cursor,
          this.config.broadcastBatchSize,
        );

        if (batch.length === 0) {
          break;
        }

        const result = await this.notify.notifyMany(
          batch.map((user) => user.id),
          {
            type: broadcast.type,
            title: broadcast.title,
            body: broadcast.body,
            data: (broadcast.data ?? null) as Record<string, unknown> | null,
            channels: broadcast.channels,
            broadcastId: broadcast.id,
            // Marketing waits for morning; the resolver exempts the categories
            // where a night-time message is the whole point.
            quietHours: PROMO_QUIET_HOURS,
          },
        );

        recipients += batch.length;
        delivered += result.delivered;
        failed += result.failed;
        skipped += result.skipped;

        await this.broadcasts.addCounts(broadcast.id, {
          recipientCount: batch.length,
          deliveredCount: result.delivered,
          failedCount: result.failed,
          skippedCount: result.skipped,
        });

        cursor = batch[batch.length - 1]?.id ?? null;

        if (batch.length < this.config.broadcastBatchSize) {
          break;
        }
      }

      // Nothing reaching anybody is a failed campaign, not a quiet success —
      // unless every recipient simply opted out, which is the system working.
      const everythingFailed = recipients > 0 && delivered === 0 && skipped === 0;

      await this.broadcasts.setStatus(
        broadcast.id,
        everythingFailed ? BroadcastStatus.FAILED : BroadcastStatus.SENT,
        { error: everythingFailed ? 'No recipient could be reached.' : null },
      );

      this.logger.log?.(
        `Broadcast ${broadcast.id} reached ${delivered}/${recipients} (${skipped} opted out)`,
        this.context,
      );

      return {
        message: `Sent to ${delivered} of ${recipients} recipient(s).`,
        delivered,
        failed,
        skipped,
      };
    } catch (error) {
      // The campaign is marked failed with its reason rather than left SENDING
      // forever, which is the state nobody can act on.
      await this.broadcasts.setStatus(broadcast.id, BroadcastStatus.FAILED, {
        error: (error as Error).message.slice(0, 500),
      });

      throw error;
    }
  }
}

@Injectable()
export class CancelBroadcastUseCase {
  constructor(private readonly broadcasts: BroadcastRepository) {}

  async execute(id: string): Promise<BroadcastDto> {
    const broadcast = await load(this.broadcasts, id);

    if (!EDITABLE.includes(broadcast.status)) {
      throw new BusinessRuleViolationException(
        `This campaign is ${broadcast.status.toLowerCase()} and can no longer be cancelled.`,
      );
    }

    return toBroadcastDto(
      await this.broadcasts.setStatus(id, BroadcastStatus.CANCELLED, {
        error: 'Cancelled before sending',
      }),
    );
  }
}

@Injectable()
export class DispatchScheduledBroadcastsUseCase {
  constructor(
    private readonly broadcasts: BroadcastRepository,
    private readonly send: SendBroadcastUseCase,
  ) {}

  /**
   * Sends the campaigns whose moment has arrived.
   *
   * A sweep rather than a timer per campaign: a scheduled send that only
   * happens if the process was running at that exact minute is not scheduling,
   * and this recovers whatever a restart missed.
   */
  async execute(limit = 10): Promise<{ sent: number }> {
    const due = await this.broadcasts.findDue(new Date(), limit);

    let sent = 0;

    for (const broadcast of due) {
      await this.send.deliver(broadcast);
      sent += 1;
    }

    return { sent };
  }
}

@Injectable()
export class SendDirectNotificationUseCase {
  constructor(private readonly notify: NotifyService) {}

  /**
   * Notifies one named user — the support desk's "let them know" button.
   *
   * Goes through the same preference check as everything else: a support agent
   * should not be able to push to somebody who turned pushes off, however good
   * the reason feels at the time.
   */
  async execute(dto: SendNotificationDto): Promise<SendResultDto> {
    const result = await this.notify.notify({
      userId: dto.userId,
      type: dto.type,
      title: dto.title,
      body: dto.body,
      data: dto.data ?? null,
      channels: dto.channels,
    });

    if (result.skipped) {
      return {
        message: 'This user has turned off notifications for that category. Nothing was sent.',
        delivered: 0,
        failed: 0,
        skipped: 1,
      };
    }

    // Reports what actually happened rather than what was permitted. "Delivered
    // on IN_APP, PUSH" when no push left the building is exactly the kind of
    // reassurance that sends a support agent looking in the wrong place.
    const reached = [
      result.notificationId === null ? null : 'their notification list',
      result.pushDelivered > 0 ? `${result.pushDelivered} device(s)` : null,
    ].filter((part) => part !== null);

    return {
      message:
        reached.length > 0
          ? `Delivered to ${reached.join(' and ')}.`
          : 'Nothing could be delivered — the user has no registered device and no in-app channel.',
      delivered: reached.length > 0 ? 1 : 0,
      failed: result.pushFailed,
      skipped: 0,
    };
  }
}

async function load(broadcasts: BroadcastRepository, id: string): Promise<Broadcast> {
  const broadcast = await broadcasts.findById(id);

  if (!broadcast) {
    throw new ResourceNotFoundException('Broadcast', id);
  }

  return broadcast;
}

/**
 * A narrowed audience needs the thing that narrows it.
 *
 * Checked here rather than left to the query, because an audience missing its
 * filter silently widens: `ROLE` without a role is every account on the
 * platform, which is the one mistake in this module that cannot be taken back.
 */
function assertAudienceIsComplete(dto: {
  audience: BroadcastAudience;
  roleFilter?: string;
  zoneId?: string;
  userIds?: string[];
}): void {
  if (dto.audience === BroadcastAudience.ROLE && !dto.roleFilter) {
    throw new BusinessRuleViolationException('A ROLE audience needs roleFilter.');
  }

  if (dto.audience === BroadcastAudience.ZONE && !dto.zoneId) {
    throw new BusinessRuleViolationException('A ZONE audience needs zoneId.');
  }

  if (dto.audience === BroadcastAudience.USER_IDS && (dto.userIds ?? []).length === 0) {
    throw new BusinessRuleViolationException('A USER_IDS audience needs at least one recipient.');
  }
}

export { describeAudience };
