import { Injectable } from '@nestjs/common';
import type { NotificationPreference, NotificationType } from '@prisma/client';

import { PrismaService } from '@/infrastructure/prisma/prisma.service';

import {
  NotificationPreferenceRepository,
  type PreferenceChannels,
} from '../../domain/repositories/notification-preference.repository';

@Injectable()
export class PrismaNotificationPreferenceRepository extends NotificationPreferenceRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async findForUser(userId: string): Promise<NotificationPreference[]> {
    return this.prisma.notificationPreference.findMany({ where: { userId } });
  }

  async upsert(
    userId: string,
    type: NotificationType,
    channels: PreferenceChannels,
  ): Promise<NotificationPreference> {
    return this.prisma.notificationPreference.upsert({
      where: { userId_type: { userId, type } },
      update: channels,
      create: { userId, type, ...channels },
    });
  }

  async upsertMany(
    userId: string,
    entries: Array<{ type: NotificationType; channels: PreferenceChannels }>,
  ): Promise<NotificationPreference[]> {
    // One transaction so a settings screen saving several toggles either
    // applies in full or not at all — a partial save would leave the UI showing
    // state the server never accepted.
    return this.prisma.$transaction(
      entries.map((entry) =>
        this.prisma.notificationPreference.upsert({
          where: { userId_type: { userId, type: entry.type } },
          update: entry.channels,
          create: { userId, type: entry.type, ...entry.channels },
        }),
      ),
    );
  }

  async reset(userId: string): Promise<number> {
    const result = await this.prisma.notificationPreference.deleteMany({ where: { userId } });
    return result.count;
  }
}
