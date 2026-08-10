import type {
  AuditAction,
  AuditLog,
  Banner,
  BannerPlacement,
  Coupon,
  CouponType,
  Prisma,
  Setting,
  SettingValueType,
  SupportTicket,
  SupportTicketMessage,
  TicketCategory,
  TicketPriority,
  TicketStatus,
  User,
  UserRole,
} from '@prisma/client';

import type { PaginatedResult } from '@/common/interfaces/paginated-result.interface';

// ── Dashboard ──────────────────────────────────────────────────

/** Headline counts, as of now. */
export interface DashboardTotals {
  customers: number;
  riders: number;
  restaurants: number;
  ordersToday: number;
  ordersInFlight: number;
  revenueToday: number;
  revenueThisMonth: number;
  averageOrderValue: number;
}

/** What needs somebody's attention, and how much of it there is. */
export interface DashboardQueues {
  restaurantsAwaitingApproval: number;
  ridersAwaitingApproval: number;
  ordersAwaitingRestaurant: number;
  ordersAwaitingRider: number;
  openTickets: number;
  pendingWithdrawals: number;
  unresolvedWebhooks: number;
}

export interface DashboardOperations {
  ridersOnline: number;
  ridersOnDelivery: number;
  restaurantsAcceptingOrders: number;
  restaurantsClosed: number;
}

export interface TimeSeriesPoint {
  date: string;
  orders: number;
  revenue: number;
}

export interface LeaderboardRow {
  id: string;
  name: string;
  orders: number;
  revenue: number;
  rating: number | null;
}

export abstract class DashboardRepository {
  abstract totals(now: Date): Promise<DashboardTotals>;
  abstract queues(): Promise<DashboardQueues>;
  abstract operations(): Promise<DashboardOperations>;

  /** Orders and revenue per day over a window, for the dashboard chart. */
  abstract dailySeries(from: Date, to: Date): Promise<TimeSeriesPoint[]>;

  abstract topRestaurants(from: Date, to: Date, limit: number): Promise<LeaderboardRow[]>;
  abstract topRiders(from: Date, to: Date, limit: number): Promise<LeaderboardRow[]>;
  abstract topCustomers(from: Date, to: Date, limit: number): Promise<LeaderboardRow[]>;

  /** Order counts by status over a window, for the funnel. */
  abstract ordersByStatus(from: Date, to: Date): Promise<Array<{ status: string; count: number }>>;
  /** Revenue split by how customers paid. */
  abstract revenueByPaymentMethod(
    from: Date,
    to: Date,
  ): Promise<Array<{ method: string; count: number; amount: number }>>;
  /** Where the orders are coming from. */
  abstract ordersByZone(
    from: Date,
    to: Date,
  ): Promise<Array<{ zoneId: string; zoneName: string; orders: number; revenue: number }>>;
  /** How much has been given away, and how often. */
  abstract couponUsage(
    from: Date,
    to: Date,
  ): Promise<Array<{ couponId: string; code: string; redemptions: number; discount: number }>>;
  /** Cancellations and rejections, with their reasons. */
  abstract cancellations(
    from: Date,
    to: Date,
  ): Promise<Array<{ status: string; cancelledBy: string | null; count: number }>>;
}

// ── Coupons ────────────────────────────────────────────────────

export interface ListCouponsFilter {
  page: number;
  limit: number;
  orderBy: Prisma.CouponOrderByWithRelationInput;
  search?: string;
  type?: CouponType;
  isActive?: boolean;
  restaurantId?: string;
  /** Only coupons redeemable right now. */
  liveOnly?: boolean;
  now?: Date;
}

export interface CouponInput {
  code: string;
  type: CouponType;
  value: number;
  maxDiscountAmount: number | null;
  minOrderAmount: number;
  description: string | null;
  startsAt: Date;
  expiresAt: Date;
  usageLimit: number | null;
  perUserLimit: number | null;
  restaurantId: string | null;
  zoneId: string | null;
  firstOrderOnly: boolean;
  isActive: boolean;
  createdById: string;
}

export abstract class CouponRepository {
  abstract findMany(filter: ListCouponsFilter): Promise<PaginatedResult<Coupon>>;
  abstract findById(id: string): Promise<Coupon | null>;
  abstract findByCode(code: string): Promise<Coupon | null>;
  abstract create(input: CouponInput): Promise<Coupon>;
  abstract update(id: string, input: Partial<CouponInput>): Promise<Coupon>;
  abstract setActive(id: string, isActive: boolean): Promise<Coupon>;
  /**
   * Removes a coupon that has never been used.
   *
   * A redeemed coupon is deactivated instead: orders reference it, and deleting
   * one would rewrite the discount out of a customer's history.
   */
  abstract delete(id: string): Promise<void>;
  abstract redemptionCount(id: string): Promise<number>;
}

// ── Banners ────────────────────────────────────────────────────

export interface ListBannersFilter {
  page: number;
  limit: number;
  placement?: BannerPlacement;
  cityId?: string;
  isActive?: boolean;
  /** Only banners inside their display window. */
  liveOnly?: boolean;
  now?: Date;
}

export interface BannerInput {
  title: string;
  subtitle: string | null;
  imageUrl: string;
  placement: BannerPlacement;
  restaurantId: string | null;
  linkUrl: string | null;
  cityId: string | null;
  sortOrder: number;
  startsAt: Date | null;
  endsAt: Date | null;
  isActive: boolean;
}

export abstract class BannerRepository {
  abstract findMany(filter: ListBannersFilter): Promise<PaginatedResult<Banner>>;
  abstract findById(id: string): Promise<Banner | null>;
  abstract create(input: BannerInput): Promise<Banner>;
  abstract update(id: string, input: Partial<BannerInput>): Promise<Banner>;
  abstract delete(id: string): Promise<void>;
  /** Applies a new display order in one transaction. */
  abstract reorder(entries: Array<{ id: string; sortOrder: number }>): Promise<Banner[]>;
}

// ── Settings ───────────────────────────────────────────────────

export interface SettingInput {
  key: string;
  value: string;
  valueType: SettingValueType;
  group: string;
  description: string | null;
  isPublic: boolean;
  updatedById: string;
}

export abstract class SettingRepository {
  abstract findMany(filter: { group?: string; publicOnly?: boolean }): Promise<Setting[]>;
  abstract findByKey(key: string): Promise<Setting | null>;
  abstract upsert(input: SettingInput): Promise<Setting>;
  /** Applies several settings together, so a related group cannot half-apply. */
  abstract upsertMany(inputs: SettingInput[]): Promise<Setting[]>;
  abstract delete(key: string): Promise<void>;
  abstract groups(): Promise<string[]>;
}

// ── Support tickets ────────────────────────────────────────────

export type TicketWithContext = SupportTicket & {
  user: Pick<User, 'id' | 'fullName' | 'phone'>;
  assignedTo: Pick<User, 'id' | 'fullName'> | null;
  order: { id: string; orderNumber: string } | null;
  messages: Array<SupportTicketMessage & { sender: Pick<User, 'id' | 'fullName' | 'role'> }>;
  _count?: { messages: number };
};

export interface ListTicketsFilter {
  page: number;
  limit: number;
  orderBy: Prisma.SupportTicketOrderByWithRelationInput;
  userId?: string;
  assignedToId?: string;
  status?: TicketStatus;
  priority?: TicketPriority;
  category?: TicketCategory;
  /** Everything still awaiting somebody. */
  openOnly?: boolean;
  search?: string;
  from?: Date;
  to?: Date;
}

export interface CreateTicketInput {
  userId: string;
  orderId: string | null;
  category: TicketCategory;
  priority: TicketPriority;
  subject: string;
  message: string;
  attachmentUrl: string | null;
}

export abstract class SupportTicketRepository {
  abstract findMany(filter: ListTicketsFilter): Promise<PaginatedResult<TicketWithContext>>;
  abstract findById(id: string): Promise<TicketWithContext | null>;

  /**
   * Opens a ticket and its first message together, with a human-readable
   * number from a sequence — the reference a customer quotes on the phone.
   */
  abstract create(input: CreateTicketInput): Promise<TicketWithContext>;

  abstract addMessage(
    ticketId: string,
    input: {
      senderId: string;
      message: string;
      attachmentUrl: string | null;
      isInternal: boolean;
      /** Applied alongside the message, when a reply moves the ticket. */
      nextStatus: TicketStatus | null;
    },
  ): Promise<TicketWithContext>;

  abstract setStatus(
    id: string,
    status: TicketStatus,
    context: { actorId: string },
  ): Promise<TicketWithContext>;

  abstract assign(id: string, assigneeId: string | null): Promise<TicketWithContext>;
  abstract setPriority(id: string, priority: TicketPriority): Promise<TicketWithContext>;

  /** Counts by status, for the dashboard and the queue tabs. */
  abstract countsByStatus(): Promise<Array<{ status: TicketStatus; count: number }>>;
}

// ── Audit log ──────────────────────────────────────────────────

export interface AuditEntryInput {
  actorId: string | null;
  actorRole: UserRole | null;
  action: AuditAction;
  entityType: string;
  entityId: string | null;
  before: Prisma.InputJsonValue | null;
  after: Prisma.InputJsonValue | null;
  ipAddress: string | null;
  userAgent: string | null;
  requestId: string | null;
}

export interface ListAuditFilter {
  page: number;
  limit: number;
  actorId?: string;
  action?: AuditAction;
  entityType?: string;
  entityId?: string;
  from?: Date;
  to?: Date;
}

export type AuditLogWithActor = AuditLog & {
  actor: Pick<User, 'id' | 'fullName' | 'phone'> | null;
};

export abstract class AuditLogRepository {
  abstract record(input: AuditEntryInput): Promise<void>;
  abstract findMany(filter: ListAuditFilter): Promise<PaginatedResult<AuditLogWithActor>>;
  abstract findById(id: string): Promise<AuditLogWithActor | null>;
  /** Everything that has ever happened to one record, oldest first. */
  abstract historyFor(entityType: string, entityId: string): Promise<AuditLogWithActor[]>;
  abstract entityTypes(): Promise<string[]>;
}
