import { SetMetadata } from '@nestjs/common';

export const REQUEST_TIMEOUT_KEY = 'requestTimeoutMs';

/**
 * Overrides the global request timeout for one handler.
 *
 * The default ceiling exists to stop a slow dependency monopolising a worker,
 * and it suits handlers whose work is a few queries. A handler that is slow by
 * nature — reading a multi-megabyte upload off a mobile connection — is not
 * misbehaving, and would otherwise be cut off mid-transfer. Raise it only where
 * the duration is the client's link speed rather than our own work.
 */
export const RequestTimeout = (milliseconds: number) =>
  SetMetadata(REQUEST_TIMEOUT_KEY, milliseconds);
