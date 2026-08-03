import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Response } from 'express';

/**
 * Emits the Terminus health payload verbatim on failure.
 *
 * Terminus signals an unhealthy check by throwing `ServiceUnavailableException`
 * carrying the full `{ status, info, error, details }` report. The global
 * `AllExceptionsFilter` would rewrite that into the standard API error
 * envelope, which would leave the probe speaking one shape when healthy and a
 * different one when not — exactly when a monitoring system needs to read which
 * dependency failed.
 *
 * Controller-scoped filters take precedence over global ones, so binding this
 * to the health controller keeps the exemption local and explicit.
 */
@Catch(ServiceUnavailableException)
export class HealthCheckExceptionFilter implements ExceptionFilter {
  catch(exception: ServiceUnavailableException, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    response.status(exception.getStatus()).json(exception.getResponse());
  }
}
