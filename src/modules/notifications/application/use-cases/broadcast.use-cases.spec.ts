import {
  BroadcastAudience,
  BroadcastStatus,
  NotificationChannel,
  NotificationType,
  UserRole,
  type Broadcast,
} from '@prisma/client';
import type { LoggerService } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';

import { ResourceNotFoundException } from '@/common/exceptions/domain.exception';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import type { notificationsConfig } from '@/config';

import type { BroadcastRepository } from '../../domain/repositories/notification.repository';
import {
  CancelBroadcastUseCase,
  CreateBroadcastUseCase,
  PreviewAudienceUseCase,
  SendBroadcastUseCase,
} from './broadcast.use-cases';
import type { NotifyService } from './notify.service';

const logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() } as unknown as LoggerService;

const ADMIN: AuthenticatedUser = {
  id: 'admin-1',
  phone: '+923000000001',
  role: UserRole.ADMIN,
  permissions: ['notifications.send'],
  staffRestaurantId: null,
  sessionId: 'session-1',
};

const CONFIG = {
  pushConcurrency: 25,
  broadcastBatchSize: 2,
  maxPushFailures: 5,
} as ConfigType<typeof notificationsConfig>;

function broadcast(overrides: Partial<Broadcast> = {}): Broadcast {
  return {
    id: 'broadcast-1',
    title: '30% off tonight',
    body: 'Order before 10pm.',
    type: NotificationType.PROMOTION,
    data: null,
    audience: BroadcastAudience.ALL,
    roleFilter: null,
    zoneId: null,
    userIds: [],
    channels: [NotificationChannel.IN_APP, NotificationChannel.PUSH],
    status: BroadcastStatus.DRAFT,
    recipientCount: 0,
    deliveredCount: 0,
    failedCount: 0,
    skippedCount: 0,
    scheduledFor: null,
    startedAt: null,
    completedAt: null,
    error: null,
    createdById: 'admin-1',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function build(options: {
  loaded?: Broadcast | null;
  batches?: Array<Array<{ id: string }>>;
  notifyResult?: { delivered: number; failed: number; skipped: number };
  audienceCount?: number;
  notifyThrows?: boolean;
}) {
  const batches = options.batches ?? [[{ id: 'user-1' }, { id: 'user-2' }], []];
  let call = 0;

  const broadcasts = {
    findById: jest.fn().mockResolvedValue('loaded' in options ? options.loaded : broadcast()),
    create: jest
      .fn()
      .mockImplementation((input: Record<string, unknown>) =>
        Promise.resolve(broadcast(input as Partial<Broadcast>)),
      ),
    setStatus: jest
      .fn()
      .mockImplementation((_id, status) => Promise.resolve(broadcast({ status }))),
    addCounts: jest.fn().mockResolvedValue(undefined),
    resolveAudience: jest.fn().mockImplementation(() => {
      const batch = batches[call] ?? [];
      call += 1;

      return Promise.resolve(batch);
    }),
    countAudience: jest.fn().mockResolvedValue(options.audienceCount ?? 1240),
    findDue: jest.fn().mockResolvedValue([]),
  } as unknown as jest.Mocked<BroadcastRepository>;

  const notify = {
    notifyMany: options.notifyThrows
      ? jest.fn().mockRejectedValue(new Error('database unavailable'))
      : jest
          .fn()
          .mockResolvedValue(options.notifyResult ?? { delivered: 2, failed: 0, skipped: 0 }),
  } as unknown as jest.Mocked<NotifyService>;

  return {
    broadcasts,
    notify,
    send: new SendBroadcastUseCase(broadcasts, notify, CONFIG, logger),
  };
}

describe('CreateBroadcastUseCase', () => {
  it('saves a campaign as a draft rather than sending it', async () => {
    const { broadcasts } = build({});
    const useCase = new CreateBroadcastUseCase(broadcasts);

    const result = await useCase.execute(
      { title: 'Hello', body: 'World', audience: BroadcastAudience.ALL },
      ADMIN,
    );

    expect(result.status).toBe(BroadcastStatus.DRAFT);
    expect(broadcasts.create).toHaveBeenCalledWith(
      expect.objectContaining({ scheduledFor: null, createdById: 'admin-1' }),
    );
  });

  it('refuses a ROLE audience with no role — that would be everybody', async () => {
    const { broadcasts } = build({});
    const useCase = new CreateBroadcastUseCase(broadcasts);

    await expect(
      useCase.execute({ title: 'Hello', body: 'World', audience: BroadcastAudience.ROLE }, ADMIN),
    ).rejects.toThrow(/needs roleFilter/);
    expect(broadcasts.create).not.toHaveBeenCalled();
  });

  it('refuses a ZONE audience with no zone', async () => {
    const { broadcasts } = build({});
    const useCase = new CreateBroadcastUseCase(broadcasts);

    await expect(
      useCase.execute({ title: 'Hello', body: 'World', audience: BroadcastAudience.ZONE }, ADMIN),
    ).rejects.toThrow(/needs zoneId/);
  });

  it('refuses a USER_IDS audience with no recipients', async () => {
    const { broadcasts } = build({});
    const useCase = new CreateBroadcastUseCase(broadcasts);

    await expect(
      useCase.execute(
        { title: 'Hello', body: 'World', audience: BroadcastAudience.USER_IDS, userIds: [] },
        ADMIN,
      ),
    ).rejects.toThrow(/at least one recipient/);
  });

  it('refuses a schedule in the past', async () => {
    const { broadcasts } = build({});
    const useCase = new CreateBroadcastUseCase(broadcasts);

    await expect(
      useCase.execute(
        {
          title: 'Hello',
          body: 'World',
          audience: BroadcastAudience.ALL,
          scheduledFor: new Date('2020-01-01T00:00:00.000Z'),
        },
        ADMIN,
      ),
    ).rejects.toThrow(/must be in the future/);
  });

  it('defaults to in-app and push when no channels are named', async () => {
    const { broadcasts } = build({});
    const useCase = new CreateBroadcastUseCase(broadcasts);

    await useCase.execute(
      { title: 'Hello', body: 'World', audience: BroadcastAudience.ALL },
      ADMIN,
    );

    expect(broadcasts.create).toHaveBeenCalledWith(
      expect.objectContaining({
        channels: [NotificationChannel.IN_APP, NotificationChannel.PUSH],
      }),
    );
  });
});

describe('PreviewAudienceUseCase', () => {
  it('reports the size of the audience without sending anything', async () => {
    const { broadcasts, notify } = build({ audienceCount: 4210 });
    const useCase = new PreviewAudienceUseCase(broadcasts);

    const preview = await useCase.execute('broadcast-1');

    expect(preview.recipientCount).toBe(4210);
    expect(preview.description).toBe('All active accounts');
    expect(notify.notifyMany).not.toHaveBeenCalled();
  });

  it('describes a role audience in words', async () => {
    const { broadcasts } = build({
      loaded: broadcast({ audience: BroadcastAudience.ROLE, roleFilter: UserRole.RIDER }),
    });

    await expect(
      new PreviewAudienceUseCase(broadcasts).execute('broadcast-1'),
    ).resolves.toMatchObject({ description: 'Everyone with the RIDER role' });
  });

  it('reports an unknown campaign as not found', async () => {
    const { broadcasts } = build({ loaded: null });

    await expect(new PreviewAudienceUseCase(broadcasts).execute('missing')).rejects.toThrow(
      ResourceNotFoundException,
    );
  });
});

describe('SendBroadcastUseCase', () => {
  it('walks the audience in batches and totals what was delivered', async () => {
    const { send, notify, broadcasts } = build({
      batches: [[{ id: 'user-1' }, { id: 'user-2' }], [{ id: 'user-3' }]],
      notifyResult: { delivered: 2, failed: 0, skipped: 0 },
    });

    const result = await send.execute('broadcast-1');

    // Batch size is 2, so a short second batch ends the walk.
    expect(notify.notifyMany).toHaveBeenCalledTimes(2);
    expect(result.delivered).toBe(4);
    expect(broadcasts.setStatus).toHaveBeenCalledWith(
      'broadcast-1',
      BroadcastStatus.SENT,
      expect.anything(),
    );
  });

  it('writes counts back as it goes, so a long send shows progress', async () => {
    const { send, broadcasts } = build({});

    await send.execute('broadcast-1');

    expect(broadcasts.addCounts).toHaveBeenCalledWith(
      'broadcast-1',
      expect.objectContaining({ recipientCount: 2, deliveredCount: 2 }),
    );
  });

  it('marks the campaign SENDING before it starts', async () => {
    const { send, broadcasts } = build({});

    await send.execute('broadcast-1');

    expect((broadcasts.setStatus as jest.Mock).mock.calls[0][1]).toBe(BroadcastStatus.SENDING);
  });

  it('holds promotional pushes back overnight', async () => {
    const { send, notify } = build({});

    await send.execute('broadcast-1');

    expect((notify.notifyMany as jest.Mock).mock.calls[0][1]).toMatchObject({
      quietHours: { startHour: 22, endHour: 8 },
    });
  });

  it('tags every message with the campaign it came from', async () => {
    const { send, notify } = build({});

    await send.execute('broadcast-1');

    expect((notify.notifyMany as jest.Mock).mock.calls[0][1]).toMatchObject({
      broadcastId: 'broadcast-1',
    });
  });

  it('counts opt-outs as skipped and still calls the campaign sent', async () => {
    const { send, broadcasts } = build({
      batches: [[{ id: 'user-1' }]],
      notifyResult: { delivered: 0, failed: 0, skipped: 1 },
    });

    const result = await send.execute('broadcast-1');

    expect(result.skipped).toBe(1);
    // Everyone opting out is the system working, not a failed campaign.
    expect(broadcasts.setStatus).toHaveBeenCalledWith(
      'broadcast-1',
      BroadcastStatus.SENT,
      expect.anything(),
    );
  });

  it('marks a campaign FAILED when nothing reached anybody', async () => {
    const { send, broadcasts } = build({
      batches: [[{ id: 'user-1' }]],
      notifyResult: { delivered: 0, failed: 1, skipped: 0 },
    });

    await send.execute('broadcast-1');

    expect(broadcasts.setStatus).toHaveBeenCalledWith(
      'broadcast-1',
      BroadcastStatus.FAILED,
      expect.objectContaining({ error: 'No recipient could be reached.' }),
    );
  });

  it('refuses to send the same campaign twice', async () => {
    const { send, notify } = build({ loaded: broadcast({ status: BroadcastStatus.SENT }) });

    await expect(send.execute('broadcast-1')).rejects.toThrow(/already been sent/);
    expect(notify.notifyMany).not.toHaveBeenCalled();
  });

  it('refuses to send a cancelled campaign', async () => {
    const { send } = build({ loaded: broadcast({ status: BroadcastStatus.CANCELLED }) });

    await expect(send.execute('broadcast-1')).rejects.toThrow(/cannot be sent/);
  });

  it('does not leave a campaign stuck in SENDING when the fan-out breaks', async () => {
    const { send, broadcasts } = build({ notifyThrows: true });

    await expect(send.execute('broadcast-1')).rejects.toThrow('database unavailable');

    expect(broadcasts.setStatus).toHaveBeenLastCalledWith(
      'broadcast-1',
      BroadcastStatus.FAILED,
      expect.objectContaining({ error: 'database unavailable' }),
    );
  });
});

describe('CancelBroadcastUseCase', () => {
  it('cancels a draft', async () => {
    const { broadcasts } = build({});

    await expect(
      new CancelBroadcastUseCase(broadcasts).execute('broadcast-1'),
    ).resolves.toMatchObject({ status: BroadcastStatus.CANCELLED });
  });

  it('refuses to cancel a campaign already delivered', async () => {
    const { broadcasts } = build({ loaded: broadcast({ status: BroadcastStatus.SENT }) });

    await expect(new CancelBroadcastUseCase(broadcasts).execute('broadcast-1')).rejects.toThrow(
      /can no longer be cancelled/,
    );
  });
});
