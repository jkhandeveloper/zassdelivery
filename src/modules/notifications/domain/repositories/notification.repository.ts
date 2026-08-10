import type {
  Broadcast,
  BroadcastAudience,
  BroadcastStatus,
  DevicePlatform,
  DeviceToken,
  Notification,
  NotificationChannel,
  NotificationType,
  Prisma,
  UserRole,
} from '@prisma/client';

import type { PaginatedResult } from '@/common/interfaces/paginated-result.interface';

export interface ListNotificationsFilter {
  page: number;
  limit: number;
  userId: string;
  type?: NotificationType;
  unreadOnly?: boolean;
  from?: Date;
  to?: Date;
}

export interface CreateNotificationInput {
  userId: string;
  type: NotificationType;
  channel: NotificationChannel;
  title: string;
  body: string;
  data: Prisma.InputJsonValue | null;
  broadcastId?: string | null;
}

/** How many are waiting, in total and by category, for the badge and the tabs. */
export interface UnreadSummary {
  total: number;
  byType: Array<{ type: NotificationType; count: number }>;
}

export abstract class NotificationRepository {
  abstract findMany(filter: ListNotificationsFilter): Promise<PaginatedResult<Notification>>;
  abstract findById(id: string): Promise<Notification | null>;

  abstract create(input: CreateNotificationInput): Promise<Notification>;

  /** Writes one row per recipient in a single statement. Returns the count. */
  abstract createMany(inputs: CreateNotificationInput[]): Promise<number>;

  abstract markRead(id: string, userId: string): Promise<Notification | null>;
  /** Marks everything unread as read. Returns how many changed. */
  abstract markAllRead(userId: string): Promise<number>;

  abstract unreadSummary(userId: string): Promise<UnreadSummary>;

  abstract delete(id: string, userId: string): Promise<boolean>;
  abstract deleteRead(userId: string): Promise<number>;

  /** Records what happened on the push leg of a notification already stored. */
  abstract recordPushResult(
    id: string,
    result: { deliveredAt: Date | null; error: string | null },
  ): Promise<void>;

  /** Housekeeping: drops read notifications older than the cut-off. */
  abstract purgeOlderThan(before: Date): Promise<number>;
}

export interface RegisterDeviceInput {
  userId: string;
  token: string;
  platform: DevicePlatform;
  deviceId: string | null;
  deviceName: string | null;
  appVersion: string | null;
}

export abstract class DeviceTokenRepository {
  abstract findForUser(userId: string, activeOnly?: boolean): Promise<DeviceToken[]>;

  /** Every live token for a set of users, for a fan-out. */
  abstract findActiveForUsers(userIds: string[]): Promise<DeviceToken[]>;

  /**
   * Registers a device, or moves an existing token to this user.
   *
   * Firebase reissues the same token to whichever account currently holds the
   * installation, so a token arriving under a new user is a handover, not a
   * duplicate — and the old owner must stop receiving that phone's pushes.
   */
  abstract register(input: RegisterDeviceInput): Promise<DeviceToken>;

  abstract deactivate(token: string): Promise<void>;
  abstract deactivateForUser(userId: string, token: string): Promise<boolean>;
  /** Signing out of every device — used when a session is revoked. */
  abstract deactivateAllForUser(userId: string): Promise<number>;

  /** Counts a soft failure, retiring the token once they stop being flukes. */
  abstract recordFailure(token: string, error: string, retireAfter: number): Promise<void>;
  abstract recordSuccess(token: string): Promise<void>;
}

export interface CreateBroadcastInput {
  title: string;
  body: string;
  type: NotificationType;
  data: Prisma.InputJsonValue | null;
  audience: BroadcastAudience;
  roleFilter: UserRole | null;
  zoneId: string | null;
  userIds: string[];
  channels: NotificationChannel[];
  scheduledFor: Date | null;
  createdById: string;
}

export interface BroadcastCounts {
  recipientCount?: number;
  deliveredCount?: number;
  failedCount?: number;
  skippedCount?: number;
}

export abstract class BroadcastRepository {
  abstract findMany(filter: {
    page: number;
    limit: number;
    status?: BroadcastStatus;
    from?: Date;
    to?: Date;
  }): Promise<PaginatedResult<Broadcast>>;

  abstract findById(id: string): Promise<Broadcast | null>;
  abstract create(input: CreateBroadcastInput): Promise<Broadcast>;
  abstract update(id: string, input: Partial<CreateBroadcastInput>): Promise<Broadcast>;

  abstract setStatus(
    id: string,
    status: BroadcastStatus,
    context?: { error?: string | null; counts?: BroadcastCounts },
  ): Promise<Broadcast>;

  /** Adds to the running totals as batches complete. */
  abstract addCounts(id: string, counts: BroadcastCounts): Promise<void>;

  /**
   * Resolves an audience into recipient ids, a page at a time.
   *
   * Paged because "everyone" is a number that only grows, and a broadcast that
   * loads the whole user table into memory works right up until the day it
   * matters.
   */
  abstract resolveAudience(
    broadcast: Pick<Broadcast, 'audience' | 'roleFilter' | 'zoneId' | 'userIds'>,
    cursor: string | null,
    take: number,
  ): Promise<Array<{ id: string }>>;

  abstract countAudience(
    broadcast: Pick<Broadcast, 'audience' | 'roleFilter' | 'zoneId' | 'userIds'>,
  ): Promise<number>;

  /** Campaigns whose scheduled moment has arrived. */
  abstract findDue(now: Date, limit: number): Promise<Broadcast[]>;
}
