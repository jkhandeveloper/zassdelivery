import { AuditAction, UserRole } from '@prisma/client';
import { of, lastValueFrom } from 'rxjs';
import type { CallHandler, ExecutionContext } from '@nestjs/common';

import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';

import type { AuditLogRepository } from '../domain/repositories/admin.repository';
import { AuditInterceptor } from './audit.interceptor';

const ADMIN: AuthenticatedUser = {
  id: 'admin-1',
  phone: '+923000000001',
  role: UserRole.ADMIN,
  permissions: [],
  sessionId: 'session-1',
};

const CUSTOMER: AuthenticatedUser = { ...ADMIN, id: 'user-1', role: UserRole.CUSTOMER };

function context(options: {
  method?: string;
  path?: string;
  user?: AuthenticatedUser;
  body?: unknown;
  params?: Record<string, string>;
  type?: string;
}): ExecutionContext {
  const request = {
    method: options.method ?? 'POST',
    path: options.path ?? '/api/v1/coupons',
    user: options.user,
    body: 'body' in options ? options.body : {},
    params: options.params ?? {},
    ip: '203.0.113.4',
    headers: { 'user-agent': 'AdminConsole/1.0' },
  };

  return {
    getType: () => options.type ?? 'http',
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function handler(result: unknown = { data: { id: 'coupon-1' } }): CallHandler {
  return { handle: () => of(result) };
}

function build() {
  const audit = {
    record: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<AuditLogRepository>;

  return { audit, interceptor: new AuditInterceptor(audit) };
}

/** Runs the interceptor and lets the fire-and-forget write settle. */
async function run(interceptor: AuditInterceptor, ctx: ExecutionContext, next = handler()) {
  const result = await lastValueFrom(interceptor.intercept(ctx, next));
  await new Promise((resolve) => setImmediate(resolve));

  return result;
}

describe('AuditInterceptor — what gets recorded', () => {
  it('records a staff mutation', async () => {
    const { interceptor, audit } = build();

    await run(interceptor, context({ user: ADMIN }));

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'admin-1',
        actorRole: UserRole.ADMIN,
        action: AuditAction.CREATE,
        entityType: 'Coupon',
        entityId: 'coupon-1',
      }),
    );
  });

  it('ignores a customer changing their own things', async () => {
    const { interceptor, audit } = build();

    await run(interceptor, context({ user: CUSTOMER }));

    expect(audit.record).not.toHaveBeenCalled();
  });

  it('ignores an unauthenticated request', async () => {
    const { interceptor, audit } = build();

    await run(interceptor, context({ user: undefined }));

    expect(audit.record).not.toHaveBeenCalled();
  });

  it('ignores reads — a log of every GET is a log nobody can search', async () => {
    const { interceptor, audit } = build();

    await run(interceptor, context({ user: ADMIN, method: 'GET' }));

    expect(audit.record).not.toHaveBeenCalled();
  });

  it('names the entity from the record, not the URL segment', async () => {
    const { interceptor, audit } = build();

    // Banners are written under `banner-management` and read from `banners`;
    // recording "BannerManagement" would split one record's history in two.
    await run(interceptor, context({ user: ADMIN, path: '/api/v1/banner-management' }));

    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ entityType: 'Banner' }));
  });

  it('ignores anything that is not an HTTP request', async () => {
    const { interceptor, audit } = build();

    await run(interceptor, context({ user: ADMIN, type: 'ws' }));

    expect(audit.record).not.toHaveBeenCalled();
  });
});

describe('AuditInterceptor — the action it infers', () => {
  const cases: Array<[string, string, AuditAction]> = [
    ['DELETE', '/api/v1/coupons/abc', AuditAction.DELETE],
    ['PATCH', '/api/v1/coupons/abc', AuditAction.UPDATE],
    ['PUT', '/api/v1/settings', AuditAction.UPDATE],
    ['POST', '/api/v1/rider-management/riders/abc/approve', AuditAction.APPROVE],
    ['POST', '/api/v1/rider-management/riders/abc/reject', AuditAction.REJECT],
    ['POST', '/api/v1/rider-management/riders/abc/suspend', AuditAction.REJECT],
    ['POST', '/api/v1/payment-management/payments/abc/refund', AuditAction.REFUND],
    ['POST', '/api/v1/order-management/abc/status', AuditAction.STATUS_CHANGE],
    ['POST', '/api/v1/coupons/abc/activate', AuditAction.STATUS_CHANGE],
    ['POST', '/api/v1/coupons/abc/deactivate', AuditAction.STATUS_CHANGE],
    ['POST', '/api/v1/coupons', AuditAction.CREATE],
  ];

  it.each(cases)('reads %s %s as %s', async (method, path, expected) => {
    const { interceptor, audit } = build();

    await run(interceptor, context({ user: ADMIN, method, path }));

    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: expected }));
  });
});

describe('AuditInterceptor — redaction', () => {
  it('never writes a password down', async () => {
    const { interceptor, audit } = build();

    await run(
      interceptor,
      context({
        user: ADMIN,
        path: '/api/v1/users',
        body: { phone: '+923001234567', password: 'Zass@1234' },
      }),
    );

    const entry = (audit.record as jest.Mock).mock.calls[0][0] as {
      after: Record<string, unknown>;
    };

    expect(entry.after.password).toBe('[redacted]');
    // The rest survives: an audit entry with nothing in it is not an audit entry.
    expect(entry.after.phone).toBe('+923001234567');
  });

  it('redacts identity and payment details', async () => {
    const { interceptor, audit } = build();

    await run(
      interceptor,
      context({
        user: ADMIN,
        body: { cnic: '1710112345678', accountNumber: '01234567890', integritySalt: 'secret' },
      }),
    );

    const entry = (audit.record as jest.Mock).mock.calls[0][0] as {
      after: Record<string, unknown>;
    };

    expect(entry.after).toEqual({
      cnic: '[redacted]',
      accountNumber: '[redacted]',
      integritySalt: '[redacted]',
    });
  });

  it('matches a redacted field however it is capitalised or nested in a name', async () => {
    const { interceptor, audit } = build();

    await run(interceptor, context({ user: ADMIN, body: { newPassword: 'x', refreshToken: 'y' } }));

    const entry = (audit.record as jest.Mock).mock.calls[0][0] as {
      after: Record<string, unknown>;
    };

    expect(entry.after).toEqual({ newPassword: '[redacted]', refreshToken: '[redacted]' });
  });

  it('handles a request with no body', async () => {
    const { interceptor, audit } = build();

    await run(interceptor, context({ user: ADMIN, body: undefined }));

    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ after: null }));
  });
});

describe('AuditInterceptor — resilience', () => {
  it('returns the response even when the audit write fails', async () => {
    const { interceptor, audit } = build();
    (audit.record as jest.Mock).mockRejectedValue(new Error('database busy'));

    // A missing entry is a gap; a failed approval because the log was busy is
    // an outage.
    await expect(run(interceptor, context({ user: ADMIN }))).resolves.toEqual({
      data: { id: 'coupon-1' },
    });
  });

  it('falls back to the path parameter when the response carries no id', async () => {
    const { interceptor, audit } = build();

    await run(
      interceptor,
      context({ user: ADMIN, method: 'DELETE', params: { id: 'coupon-9' } }),
      handler({ data: { message: 'Coupon deleted.' } }),
    );

    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ entityId: 'coupon-9' }));
  });
});
