import { SetMetadata } from '@nestjs/common';

export const SKIP_RESPONSE_WRAP_KEY = 'skipResponseWrap';

/**
 * Opts a handler out of the standard success envelope.
 *
 * Needed wherever the response shape is dictated by something other than our
 * own API contract — file downloads, streams, or third-party webhook callbacks
 * that expect a bare body.
 */
export const SkipResponseWrap = () => SetMetadata(SKIP_RESPONSE_WRAP_KEY, true);
