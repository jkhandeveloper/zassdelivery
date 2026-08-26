import { IsUrl, type ValidationOptions } from 'class-validator';

/**
 * An absolute `http(s)` URL, including one whose host has no public suffix.
 *
 * `@IsUrl()` requires a registered TLD by default, which quietly rejects three
 * hosts this platform legitimately produces: `localhost` in development, a
 * Docker service name like `http://api:3000` between containers, and a bare IP
 * on an internal network. Since `/uploads` builds its download URLs from
 * `PUBLIC_BASE_URL`, that default would make a file the API itself just stored
 * unusable as a `fileUrl` — a validation failure with no bad input behind it.
 *
 * The protocol is still required, so a bare path or a `javascript:` payload is
 * still refused.
 */
export const IsAbsoluteUrl = (validationOptions?: ValidationOptions): PropertyDecorator =>
  IsUrl({ require_protocol: true, require_tld: false }, validationOptions);
