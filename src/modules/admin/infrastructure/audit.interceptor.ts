import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { AuditAction, UserRole } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { tap } from 'rxjs/operators';
import type { Request } from 'express';
import type { Observable } from 'rxjs';

import { RequestContext } from '@/common/context/request-context';
import type { RequestWithUser } from '@/common/interfaces/authenticated-user.interface';

import { AuditLogRepository } from '../domain/repositories/admin.repository';

/** Roles whose changes are worth a permanent record. */
const AUDITED_ROLES: UserRole[] = [UserRole.ADMIN, UserRole.SUPER_ADMIN];

/** Fields never written to the log, whatever they are called. */
const REDACTED = [
  'password',
  'currentPassword',
  'newPassword',
  'token',
  'accessToken',
  'refreshToken',
  'privateKey',
  'hashKey',
  'integritySalt',
  'secret',
  'cnic',
  'accountNumber',
  'code',
];

/** Path segment → the entity a change is about. */
const ENTITY_BY_SEGMENT: Record<string, string> = {
  users: 'User',
  'restaurant-management': 'Restaurant',
  'menu-management': 'MenuItem',
  'order-management': 'Order',
  'rider-management': 'Rider',
  'payment-management': 'Payment',
  'notification-management': 'Broadcast',
  coupons: 'Coupon',
  banners: 'Banner',
  // Banners are written under a different segment from the one they are read
  // from. Without this the same record's history would split across two names.
  'banner-management': 'Banner',
  settings: 'Setting',
  'support-tickets': 'SupportTicket',
};

/**
 * Records what staff change.
 *
 * Registered globally so the log cannot be forgotten. An audit trail that each
 * feature has to remember to write to is an audit trail with holes in exactly
 * the places somebody wanted them — and the holes are invisible until the day
 * somebody asks who changed a commission rate.
 *
 * Deliberately narrow: only mutations, only by staff, and only after they
 * succeed. Reads are not interesting, a customer editing their own address is
 * not an audit event, and a rejected request changed nothing.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly audit: AuditLogRepository) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<Request & RequestWithUser>();
    const user = request.user;

    if (user === undefined || !AUDITED_ROLES.includes(user.role)) {
      return next.handle();
    }

    const action = this.actionFor(request.method, request.path);

    if (action === null) {
      return next.handle();
    }

    return next.handle().pipe(
      tap({
        next: (result) => {
          // Fire-and-forget: an audit write must never fail the operation it
          // describes. A missing entry is a gap; a failed approval because the
          // log was busy is an outage.
          void this.record(request, user, action, result).catch(() => undefined);
        },
      }),
    );
  }

  private async record(
    request: Request & RequestWithUser,
    user: NonNullable<RequestWithUser['user']>,
    action: AuditAction,
    result: unknown,
  ): Promise<void> {
    const segments = request.path.split('/').filter((part) => part !== '');
    // Skip `api` and `v1` to reach the module segment.
    const moduleSegment = segments[2] ?? '';

    await this.audit.record({
      actorId: user.id,
      actorRole: user.role,
      action,
      entityType: ENTITY_BY_SEGMENT[moduleSegment] ?? this.titleCase(moduleSegment),
      entityId: this.entityIdFrom(request, result),
      // The request body is the "after" the operator asked for; capturing the
      // prior state generically would mean a read before every write, on every
      // route, for a log.
      before: null,
      after: this.redact(request.body) as Prisma.InputJsonValue | null,
      ipAddress: request.ip ?? null,
      userAgent: request.headers['user-agent'] ?? null,
      // Ties the entry to the access log line and every other record of the
      // same request.
      requestId: RequestContext.get()?.requestId ?? null,
    });
  }

  /**
   * What kind of change this was.
   *
   * Reads return null and are not recorded: a log that captures every GET is a
   * log nobody can search, and the interesting question is always what changed.
   */
  private actionFor(method: string, path: string): AuditAction | null {
    if (method === 'DELETE') {
      return AuditAction.DELETE;
    }

    if (method === 'PATCH' || method === 'PUT') {
      return AuditAction.UPDATE;
    }

    if (method !== 'POST') {
      return null;
    }

    // The verb at the end of a POST path says more than "created" does.
    if (/\/(approve|verify|reinstate)$/.test(path)) {
      return AuditAction.APPROVE;
    }

    if (/\/(reject|suspend|fail|cancel)$/.test(path)) {
      return AuditAction.REJECT;
    }

    if (/\/refund$/.test(path)) {
      return AuditAction.REFUND;
    }

    if (
      /\/(status|read|assign|send|paid|mark-collected|activate|deactivate|resubmit|expire)$/.test(
        path,
      )
    ) {
      return AuditAction.STATUS_CHANGE;
    }

    return AuditAction.CREATE;
  }

  /** The record that changed — from the response when it says, else the path. */
  private entityIdFrom(request: Request, result: unknown): string | null {
    const data = (result as { data?: { id?: unknown } } | undefined)?.data;

    if (typeof data?.id === 'string') {
      return data.id;
    }

    const params = request.params as Record<string, string> | undefined;

    return params?.id ?? params?.orderId ?? params?.userId ?? null;
  }

  /**
   * Strips anything that must not be written down.
   *
   * An audit log is read by more people than the systems that hold the original
   * data, and it is kept for longer. A password or a CNIC copied into it is a
   * secret that has quietly become less protected than it was.
   */
  private redact(body: unknown): Record<string, unknown> | null {
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      return null;
    }

    const safe: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
      const sensitive = REDACTED.some((field) => key.toLowerCase().includes(field.toLowerCase()));

      safe[key] = sensitive ? '[redacted]' : value;
    }

    return safe;
  }

  private titleCase(segment: string): string {
    return segment
      .split('-')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join('');
  }
}
