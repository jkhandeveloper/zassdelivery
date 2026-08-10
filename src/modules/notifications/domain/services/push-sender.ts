/** One message, addressed to one device. */
export interface PushMessage {
  token: string;
  title: string;
  body: string;
  /**
   * Deep-link payload. FCM requires every data value to be a string, so this is
   * flattened before it leaves — a nested object silently fails to deliver.
   */
  data?: Record<string, string>;
  /** ORDER_UPDATE wakes the phone; PROMOTION waits for the next unlock. */
  highPriority?: boolean;
}

export interface PushOutcome {
  token: string;
  delivered: boolean;
  /** The provider's own message id, when it accepted the message. */
  messageId: string | null;
  error: string | null;
  /**
   * Whether the provider said this token is dead.
   *
   * The difference that matters: a dead token should be retired immediately,
   * while a timeout or a 503 should not cost a customer their notifications.
   */
  tokenIsDead: boolean;
}

/**
 * How a push actually leaves the platform.
 *
 * A port rather than a Firebase import, for two reasons. The obvious one is
 * that provider changes should not reach the flows. The useful one is that
 * every notification path can be tested without a network — and push code that
 * can only be exercised against a live Firebase project is push code nobody
 * exercises.
 */
export abstract class PushSender {
  /** Short stable name, recorded against delivery failures. */
  abstract readonly name: string;

  /**
   * Whether credentials are present.
   *
   * Checked before a send is attempted, so an unconfigured deployment reports
   * push as unavailable rather than logging a failure per notification.
   */
  abstract isConfigured(): boolean;

  abstract send(message: PushMessage): Promise<PushOutcome>;

  /**
   * Sends to many devices at once. Implementations bound their own concurrency:
   * a broadcast to ten thousand phones must not open ten thousand sockets.
   */
  abstract sendMany(messages: PushMessage[]): Promise<PushOutcome[]>;
}
