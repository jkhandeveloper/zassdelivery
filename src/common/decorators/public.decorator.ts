import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Marks a route as reachable without authentication.
 *
 * `JwtAuthGuard` is registered globally, so access is denied by default and
 * every exception has to be declared here. Opting *out* is far safer than
 * opting in: forgetting this decorator breaks a public endpoint loudly,
 * whereas forgetting to add a guard would silently expose a private one.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
