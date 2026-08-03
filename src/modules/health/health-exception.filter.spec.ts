import { type ArgumentsHost, ServiceUnavailableException } from '@nestjs/common';

import { HealthCheckExceptionFilter } from './health-exception.filter';

describe('HealthCheckExceptionFilter', () => {
  it('emits the Terminus payload verbatim rather than the API error envelope', () => {
    const captured: { status?: number; body?: unknown } = {};
    const host = {
      switchToHttp: () => ({
        getResponse: () => ({
          status(code: number) {
            captured.status = code;
            return this;
          },
          json(body: unknown) {
            captured.body = body;
          },
        }),
      }),
    } as unknown as ArgumentsHost;

    const report = {
      status: 'error',
      info: {},
      error: { database: { status: 'down', message: 'connection refused' } },
      details: { database: { status: 'down' } },
    };

    new HealthCheckExceptionFilter().catch(new ServiceUnavailableException(report), host);

    expect(captured.status).toBe(503);
    // Monitoring needs to read which dependency failed; rewriting this into the
    // standard envelope would discard the per-indicator report.
    expect(captured.body).toEqual(report);
  });
});
