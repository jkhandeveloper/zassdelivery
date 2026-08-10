import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  AuditAction,
  BannerPlacement,
  CouponType,
  SettingValueType,
  TicketCategory,
  TicketPriority,
  TicketStatus,
  UserRole,
  type Banner,
  type Coupon,
  type Setting,
} from '@prisma/client';

import type {
  AuditLogWithActor,
  TicketWithContext,
} from '../../domain/repositories/admin.repository';
import { CouponRules } from '../../domain/services/coupon-rules';

// ── Dashboard ──────────────────────────────────────────────────

export class DashboardTotalsDto {
  @ApiProperty({ example: 4218 }) customers!: number;
  @ApiProperty({ example: 62 }) riders!: number;
  @ApiProperty({ example: 37 }) restaurants!: number;
  @ApiProperty({ example: 214 }) ordersToday!: number;
  @ApiProperty({ example: 18, description: 'Orders somewhere between placed and delivered.' })
  ordersInFlight!: number;
  @ApiProperty({ example: 189420 }) revenueToday!: number;
  @ApiProperty({ example: 4210500 }) revenueThisMonth!: number;
  @ApiProperty({ example: 885.14 }) averageOrderValue!: number;
}

export class DashboardQueuesDto {
  @ApiProperty({ example: 3 }) restaurantsAwaitingApproval!: number;
  @ApiProperty({ example: 7 }) ridersAwaitingApproval!: number;
  @ApiProperty({ example: 4, description: 'Placed, not yet accepted by the kitchen.' })
  ordersAwaitingRestaurant!: number;
  @ApiProperty({
    example: 2,
    description: 'Cooking or cooked with nobody to carry them — the cold-delivery number.',
  })
  ordersAwaitingRider!: number;
  @ApiProperty({ example: 11 }) openTickets!: number;
  @ApiProperty({ example: 5 }) pendingWithdrawals!: number;
  @ApiProperty({ example: 1, description: 'Gateway callbacks stored but not applied.' })
  unresolvedWebhooks!: number;
}

export class DashboardOperationsDto {
  @ApiProperty({ example: 24 }) ridersOnline!: number;
  @ApiProperty({ example: 15 }) ridersOnDelivery!: number;
  @ApiProperty({ example: 31 }) restaurantsAcceptingOrders!: number;
  @ApiProperty({ example: 6, description: 'Approved but paused or outside their hours.' })
  restaurantsClosed!: number;
}

export class TimeSeriesPointDto {
  @ApiProperty({ example: '2026-08-10' }) date!: string;
  @ApiProperty({ example: 214 }) orders!: number;
  @ApiProperty({ example: 189420 }) revenue!: number;
}

export class DashboardDto {
  @ApiProperty({ type: DashboardTotalsDto }) totals!: DashboardTotalsDto;
  @ApiProperty({
    type: DashboardQueuesDto,
    description: 'The part that is actually a to-do list: every number has a screen behind it.',
  })
  queues!: DashboardQueuesDto;
  @ApiProperty({ type: DashboardOperationsDto }) operations!: DashboardOperationsDto;
  @ApiProperty({ type: [TimeSeriesPointDto], description: 'The last 14 days.' })
  trend!: TimeSeriesPointDto[];
  @ApiProperty({ example: 12, description: 'Everything in the queues, added up.' })
  actionsRequired!: number;
  @ApiProperty() generatedAt!: Date;
}

export class LeaderboardRowDto {
  @ApiProperty() id!: string;
  @ApiProperty({ example: 'Chapli Kabab House' }) name!: string;
  @ApiProperty({ example: 412 }) orders!: number;
  @ApiProperty({ example: 364820 }) revenue!: number;
  @ApiPropertyOptional({ nullable: true, example: 4.6 }) rating!: number | null;
}

export class BreakdownRowDto {
  @ApiProperty({ example: 'DELIVERED' }) label!: string;
  @ApiProperty({ example: 1842 }) count!: number;
  @ApiPropertyOptional({ example: 1620400 }) amount?: number;
}

export class SalesReportDto {
  @ApiProperty() from!: Date;
  @ApiProperty() to!: Date;
  @ApiProperty({ example: 5218 }) orders!: number;
  @ApiProperty({ example: 4620400, description: 'Orders that were paid for, or will be.' })
  revenue!: number;
  @ApiProperty({ example: 693060 }) commission!: number;
  @ApiProperty({ example: 361200 }) deliveryFees!: number;
  @ApiProperty({ example: 42100 }) discounts!: number;
  @ApiProperty({ example: 885.4 }) averageOrderValue!: number;
  @ApiProperty({ type: [TimeSeriesPointDto] }) daily!: TimeSeriesPointDto[];
  @ApiProperty({ type: [BreakdownRowDto] }) byPaymentMethod!: BreakdownRowDto[];
  @ApiProperty({ type: [BreakdownRowDto] }) byStatus!: BreakdownRowDto[];
}

export class ZoneReportRowDto {
  @ApiProperty() zoneId!: string;
  @ApiProperty({ example: 'Pabbi Central' }) zoneName!: string;
  @ApiProperty({ example: 812 }) orders!: number;
  @ApiProperty({ example: 718400 }) revenue!: number;
  @ApiProperty({ example: 884.7 }) averageOrderValue!: number;
}

export class CouponReportRowDto {
  @ApiProperty() couponId!: string;
  @ApiProperty({ example: 'ZASS100' }) code!: string;
  @ApiProperty({ example: 214 }) redemptions!: number;
  @ApiProperty({ example: 21400, description: 'What the discount actually cost.' })
  discount!: number;
}

export class CancellationReportRowDto {
  @ApiProperty({ example: 'CANCELLED' }) status!: string;
  @ApiPropertyOptional({ nullable: true, example: 'CUSTOMER' }) cancelledBy!: string | null;
  @ApiProperty({ example: 42 }) count!: number;
}

// ── Coupons ────────────────────────────────────────────────────

export class CouponDto {
  @ApiProperty() id!: string;
  @ApiProperty({ example: 'ZASS100' }) code!: string;
  @ApiProperty({ enum: CouponType }) type!: CouponType;
  @ApiProperty({ example: 20 }) value!: number;
  @ApiPropertyOptional({ nullable: true, example: 200 }) maxDiscountAmount!: number | null;
  @ApiProperty({ example: 500 }) minOrderAmount!: number;
  @ApiPropertyOptional({ nullable: true }) description!: string | null;
  @ApiProperty() startsAt!: Date;
  @ApiProperty() expiresAt!: Date;
  @ApiPropertyOptional({ nullable: true, example: 1000 }) usageLimit!: number | null;
  @ApiProperty({ example: 214 }) usageCount!: number;
  @ApiPropertyOptional({ nullable: true, example: 1 }) perUserLimit!: number | null;
  @ApiPropertyOptional({ nullable: true }) restaurantId!: string | null;
  @ApiPropertyOptional({ nullable: true }) zoneId!: string | null;
  @ApiProperty({ example: false }) firstOrderOnly!: boolean;
  @ApiProperty({ example: true }) isActive!: boolean;
  @ApiProperty({
    example: true,
    description: 'Whether it can be redeemed right now — active, in window and not exhausted.',
  })
  isLive!: boolean;
  @ApiPropertyOptional({
    nullable: true,
    example: 786,
    description: 'Redemptions left, or null when unlimited.',
  })
  remainingUses!: number | null;
  @ApiProperty() createdAt!: Date;
}

// ── Banners ────────────────────────────────────────────────────

export class BannerDto {
  @ApiProperty() id!: string;
  @ApiProperty({ example: 'Free delivery this weekend' }) title!: string;
  @ApiPropertyOptional({ nullable: true }) subtitle!: string | null;
  @ApiProperty() imageUrl!: string;
  @ApiProperty({ enum: BannerPlacement }) placement!: BannerPlacement;
  @ApiPropertyOptional({ nullable: true }) restaurantId!: string | null;
  @ApiPropertyOptional({ nullable: true }) linkUrl!: string | null;
  @ApiPropertyOptional({ nullable: true }) cityId!: string | null;
  @ApiProperty({ example: 0 }) sortOrder!: number;
  @ApiPropertyOptional({ nullable: true }) startsAt!: Date | null;
  @ApiPropertyOptional({ nullable: true }) endsAt!: Date | null;
  @ApiProperty({ example: true }) isActive!: boolean;
  @ApiProperty({ example: true, description: 'Active and inside its display window.' })
  isLive!: boolean;
  @ApiProperty() createdAt!: Date;
}

// ── Settings ───────────────────────────────────────────────────

export class SettingDto {
  @ApiProperty({ example: 'platform.service_fee_percentage' }) key!: string;
  @ApiProperty({ example: '5' }) value!: string;
  @ApiProperty({ enum: SettingValueType }) valueType!: SettingValueType;
  @ApiProperty({
    description: 'The value coerced to its declared type — what a client should actually read.',
    example: 5,
  })
  typedValue!: unknown;
  @ApiProperty({ example: 'pricing' }) group!: string;
  @ApiPropertyOptional({ nullable: true }) description!: string | null;
  @ApiProperty({ example: true }) isPublic!: boolean;
  @ApiProperty() updatedAt!: Date;
}

export class SettingGroupDto {
  @ApiProperty({ example: 'pricing' }) group!: string;
  @ApiProperty({ type: [SettingDto] }) settings!: SettingDto[];
}

// ── Support tickets ────────────────────────────────────────────

export class TicketMessageDto {
  @ApiProperty() id!: string;
  @ApiProperty({ example: 'We have refunded the missing items.' }) message!: string;
  @ApiPropertyOptional({ nullable: true }) attachmentUrl!: string | null;
  @ApiProperty({ example: false, description: 'Internal notes are never shown to the customer.' })
  isInternal!: boolean;
  @ApiProperty({ example: 'Operations Admin' }) senderName!: string;
  @ApiProperty({ enum: UserRole }) senderRole!: UserRole;
  @ApiProperty({ example: true, description: 'Whether the sender was the customer.' })
  fromCustomer!: boolean;
  @ApiProperty() createdAt!: Date;
}

export class TicketDto {
  @ApiProperty() id!: string;
  @ApiProperty({ example: 'TKT-260810-0001' }) ticketNumber!: string;
  @ApiProperty({ enum: TicketCategory }) category!: TicketCategory;
  @ApiProperty({ enum: TicketPriority }) priority!: TicketPriority;
  @ApiProperty({ enum: TicketStatus }) status!: TicketStatus;
  @ApiProperty({ example: 'Two items were missing from my order' }) subject!: string;

  @ApiProperty({ example: 'Ahmad Khan' }) customerName!: string;
  @ApiProperty({ example: '+923001234567' }) customerPhone!: string;
  @ApiPropertyOptional({ nullable: true, example: 'Operations Admin' })
  assignedToName!: string | null;
  @ApiPropertyOptional({ nullable: true }) assignedToId!: string | null;
  @ApiPropertyOptional({ nullable: true, example: 'ZD-260810-0007' }) orderNumber!: string | null;
  @ApiPropertyOptional({ nullable: true }) orderId!: string | null;

  @ApiProperty({ example: 3 }) messageCount!: number;
  @ApiProperty({ type: [TicketMessageDto] }) messages!: TicketMessageDto[];

  @ApiProperty({ example: true, description: 'Whether it is still awaiting somebody.' })
  isOpen!: boolean;
  @ApiPropertyOptional({ nullable: true }) resolvedAt!: Date | null;
  @ApiPropertyOptional({ nullable: true }) closedAt!: Date | null;
  @ApiProperty() createdAt!: Date;
  @ApiProperty() updatedAt!: Date;
}

// ── Audit log ──────────────────────────────────────────────────

export class AuditLogDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: AuditAction }) action!: AuditAction;
  @ApiProperty({ example: 'Coupon' }) entityType!: string;
  @ApiPropertyOptional({ nullable: true }) entityId!: string | null;
  @ApiPropertyOptional({ nullable: true, example: 'Operations Admin' }) actorName!: string | null;
  @ApiPropertyOptional({ nullable: true }) actorId!: string | null;
  @ApiPropertyOptional({ nullable: true, enum: UserRole }) actorRole!: UserRole | null;
  @ApiPropertyOptional({ nullable: true, type: 'object', additionalProperties: true })
  before!: unknown;
  @ApiPropertyOptional({ nullable: true, type: 'object', additionalProperties: true })
  after!: unknown;
  @ApiPropertyOptional({ nullable: true, example: '203.0.113.4' }) ipAddress!: string | null;
  @ApiPropertyOptional({
    nullable: true,
    description: 'Correlates the entry with the request that produced it.',
  })
  requestId!: string | null;
  @ApiProperty() createdAt!: Date;
}

// ── Mappers ────────────────────────────────────────────────────

export function toCouponDto(coupon: Coupon, now: Date = new Date()): CouponDto {
  return {
    id: coupon.id,
    code: coupon.code,
    type: coupon.type,
    value: Number(coupon.value),
    maxDiscountAmount: coupon.maxDiscountAmount === null ? null : Number(coupon.maxDiscountAmount),
    minOrderAmount: Number(coupon.minOrderAmount),
    description: coupon.description,
    startsAt: coupon.startsAt,
    expiresAt: coupon.expiresAt,
    usageLimit: coupon.usageLimit,
    usageCount: coupon.usageCount,
    perUserLimit: coupon.perUserLimit,
    restaurantId: coupon.restaurantId,
    zoneId: coupon.zoneId,
    firstOrderOnly: coupon.firstOrderOnly,
    isActive: coupon.isActive,
    // Three conditions, computed once here rather than by each client: a coupon
    // can be `isActive` and still unusable because it has expired or run out.
    isLive: CouponRules.isLive(coupon, now),
    remainingUses:
      coupon.usageLimit === null ? null : Math.max(0, coupon.usageLimit - coupon.usageCount),
    createdAt: coupon.createdAt,
  };
}

export function toBannerDto(banner: Banner, now: Date = new Date()): BannerDto {
  return {
    id: banner.id,
    title: banner.title,
    subtitle: banner.subtitle,
    imageUrl: banner.imageUrl,
    placement: banner.placement,
    restaurantId: banner.restaurantId,
    linkUrl: banner.linkUrl,
    cityId: banner.cityId,
    sortOrder: banner.sortOrder,
    startsAt: banner.startsAt,
    endsAt: banner.endsAt,
    isActive: banner.isActive,
    isLive:
      banner.isActive &&
      (banner.startsAt === null || banner.startsAt <= now) &&
      (banner.endsAt === null || banner.endsAt > now),
    createdAt: banner.createdAt,
  };
}

/**
 * Coerces a stored setting to its declared type.
 *
 * Settings are stored as text because the table holds every kind at once, but a
 * client parsing `"5"` into a number by convention is a client that will one
 * day parse `"false"` into `true`.
 */
export function toSettingDto(setting: Setting): SettingDto {
  let typedValue: unknown;

  switch (setting.valueType) {
    case SettingValueType.NUMBER: {
      const parsed = Number(setting.value);
      typedValue = Number.isFinite(parsed) ? parsed : null;
      break;
    }
    case SettingValueType.BOOLEAN:
      typedValue = setting.value === 'true' || setting.value === '1';
      break;
    case SettingValueType.JSON:
      try {
        typedValue = JSON.parse(setting.value);
      } catch {
        // A malformed value must not break the whole settings screen.
        typedValue = null;
      }
      break;
    default:
      typedValue = setting.value;
  }

  return {
    key: setting.key,
    value: setting.value,
    valueType: setting.valueType,
    typedValue,
    group: setting.group,
    description: setting.description,
    isPublic: setting.isPublic,
    updatedAt: setting.updatedAt,
  };
}

export interface TicketDtoOptions {
  /** Internal notes are stripped for anyone who is not staff. */
  includeInternal?: boolean;
}

export function toTicketDto(ticket: TicketWithContext, options: TicketDtoOptions = {}): TicketDto {
  const visible = ticket.messages.filter(
    (message) => options.includeInternal === true || !message.isInternal,
  );

  return {
    id: ticket.id,
    ticketNumber: ticket.ticketNumber,
    category: ticket.category,
    priority: ticket.priority,
    status: ticket.status,
    subject: ticket.subject,
    customerName: ticket.user.fullName,
    customerPhone: ticket.user.phone,
    assignedToName: ticket.assignedTo?.fullName ?? null,
    assignedToId: ticket.assignedToId,
    orderNumber: ticket.order?.orderNumber ?? null,
    orderId: ticket.orderId,
    messageCount: visible.length,
    messages: visible.map((message) => ({
      id: message.id,
      message: message.message,
      attachmentUrl: message.attachmentUrl,
      isInternal: message.isInternal,
      senderName: message.sender.fullName,
      senderRole: message.sender.role,
      fromCustomer: message.senderId === ticket.userId,
      createdAt: message.createdAt,
    })),
    isOpen: ticket.status !== TicketStatus.CLOSED && ticket.status !== TicketStatus.RESOLVED,
    resolvedAt: ticket.resolvedAt,
    closedAt: ticket.closedAt,
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt,
  };
}

export function toAuditLogDto(entry: AuditLogWithActor): AuditLogDto {
  return {
    id: entry.id,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    actorName: entry.actor?.fullName ?? null,
    actorId: entry.actorId,
    actorRole: entry.actorRole,
    before: entry.before,
    after: entry.after,
    ipAddress: entry.ipAddress,
    requestId: entry.requestId,
    createdAt: entry.createdAt,
  };
}
