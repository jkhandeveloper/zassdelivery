import { registerAs } from '@nestjs/config';

export const NOTIFICATIONS_CONFIG_KEY = 'notifications';

/**
 * Push delivery configuration.
 *
 * Firebase credentials come from a service-account key. The private key is
 * multi-line PEM, which no `.env` file can hold literally, so the escaped `\n`
 * that every deployment tool produces is unescaped here rather than in five
 * places downstream.
 */
export const notificationsConfig = registerAs(NOTIFICATIONS_CONFIG_KEY, () => ({
  fcm: {
    projectId: process.env.FCM_PROJECT_ID ?? '',
    clientEmail: process.env.FCM_CLIENT_EMAIL ?? '',
    privateKey: (process.env.FCM_PRIVATE_KEY ?? '').replace(/\\n/g, '\n'),
  },

  /** How many pushes are in flight at once during a broadcast fan-out. */
  pushConcurrency: Number(process.env.PUSH_CONCURRENCY ?? 25),

  /** Recipients handled per pass of a broadcast, to bound memory and lock time. */
  broadcastBatchSize: Number(process.env.BROADCAST_BATCH_SIZE ?? 500),

  /**
   * Consecutive failures after which a device token is retired.
   *
   * Firebase telling us a token is dead retires it immediately; this only
   * governs the softer failures, where one bad night should not cost a customer
   * their notifications.
   */
  maxPushFailures: Number(process.env.PUSH_MAX_FAILURES ?? 5),
}));
