/**
 * How a text message leaves the platform.
 *
 * A port, like `PushSender`, so the provider can change without the sign-up
 * flow noticing — and so the OTP rules can be tested without sending a text.
 */
export abstract class SmsSender {
  /** Short stable name, for logs. */
  abstract readonly name: string;

  /** Whether this deployment can actually send. Verification is off when not. */
  abstract isConfigured(): boolean;

  /** Sends one message to one E.164 number. Throws when it was not accepted. */
  abstract send(to: string, message: string): Promise<void>;
}
