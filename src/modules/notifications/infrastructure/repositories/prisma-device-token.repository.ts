import { Injectable } from '@nestjs/common';
import type { DeviceToken } from '@prisma/client';

import { PrismaService } from '@/infrastructure/prisma/prisma.service';

import {
  DeviceTokenRepository,
  type RegisterDeviceInput,
} from '../../domain/repositories/notification.repository';

@Injectable()
export class PrismaDeviceTokenRepository extends DeviceTokenRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async findForUser(userId: string, activeOnly = true): Promise<DeviceToken[]> {
    return this.prisma.deviceToken.findMany({
      where: { userId, ...(activeOnly && { isActive: true }) },
      orderBy: { lastUsedAt: 'desc' },
    });
  }

  async findActiveForUsers(userIds: string[]): Promise<DeviceToken[]> {
    if (userIds.length === 0) {
      return [];
    }

    return this.prisma.deviceToken.findMany({
      where: { userId: { in: userIds }, isActive: true },
    });
  }

  async register(input: RegisterDeviceInput): Promise<DeviceToken> {
    return this.prisma.$transaction(async (tx) => {
      // A refreshed token on a known installation replaces its predecessor.
      // Without this, every Firebase token rotation leaves a dead row behind
      // and the fan-out slowly fills with addresses nobody answers.
      if (input.deviceId !== null) {
        await tx.deviceToken.updateMany({
          where: {
            userId: input.userId,
            deviceId: input.deviceId,
            token: { not: input.token },
            isActive: true,
          },
          data: { isActive: false, lastError: 'Replaced by a refreshed token' },
        });
      }

      // Upserting on the token itself is what handles a handover: Firebase
      // reissues the same token to whichever account currently holds the
      // installation, so the row moves to the new user and the previous owner
      // stops receiving that phone's notifications.
      return tx.deviceToken.upsert({
        where: { token: input.token },
        update: {
          userId: input.userId,
          platform: input.platform,
          deviceId: input.deviceId,
          deviceName: input.deviceName,
          appVersion: input.appVersion,
          isActive: true,
          failureCount: 0,
          lastError: null,
          lastUsedAt: new Date(),
        },
        create: {
          userId: input.userId,
          token: input.token,
          platform: input.platform,
          deviceId: input.deviceId,
          deviceName: input.deviceName,
          appVersion: input.appVersion,
          lastUsedAt: new Date(),
        },
      });
    });
  }

  async deactivate(token: string): Promise<void> {
    await this.prisma.deviceToken.updateMany({
      where: { token },
      data: { isActive: false },
    });
  }

  async deactivateForUser(userId: string, token: string): Promise<boolean> {
    const result = await this.prisma.deviceToken.updateMany({
      where: { userId, token, isActive: true },
      data: { isActive: false, lastError: 'Signed out' },
    });

    return result.count > 0;
  }

  async deactivateAllForUser(userId: string): Promise<number> {
    const result = await this.prisma.deviceToken.updateMany({
      where: { userId, isActive: true },
      data: { isActive: false, lastError: 'Signed out of all devices' },
    });

    return result.count;
  }

  async recordFailure(token: string, error: string, retireAfter: number): Promise<void> {
    const updated = await this.prisma.deviceToken.update({
      where: { token },
      data: { failureCount: { increment: 1 }, lastError: error.slice(0, 300) },
      select: { failureCount: true },
    });

    // One bad night should not cost a customer their notifications, but a token
    // that has failed this many times in a row is not coming back.
    if (updated.failureCount >= retireAfter) {
      await this.prisma.deviceToken.update({
        where: { token },
        data: { isActive: false },
      });
    }
  }

  async recordSuccess(token: string): Promise<void> {
    await this.prisma.deviceToken.update({
      where: { token },
      // The failure count is consecutive, so a success clears it: a device that
      // missed one push and then received the next is healthy.
      data: { failureCount: 0, lastError: null, lastUsedAt: new Date() },
    });
  }
}
