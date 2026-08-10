import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';

import { AdminDashboardController } from './admin-dashboard.controller';
import {
  CreateBannerUseCase,
  CreateCouponUseCase,
  DeleteBannerUseCase,
  DeleteCouponUseCase,
  DeleteSettingUseCase,
  GetCouponUseCase,
  ListBannersUseCase,
  ListCouponsUseCase,
  ListSettingsUseCase,
  ReorderBannersUseCase,
  SetCouponActiveUseCase,
  UpdateBannerUseCase,
  UpdateCouponUseCase,
  UpsertSettingsUseCase,
} from './application/use-cases/content.use-cases';
import {
  DashboardUseCase,
  LeaderboardUseCase,
  OperationsReportUseCase,
  SalesReportUseCase,
} from './application/use-cases/dashboard.use-cases';
import {
  AssignTicketUseCase,
  AuditFacetsUseCase,
  ChangeTicketPriorityUseCase,
  ChangeTicketStatusUseCase,
  CreateTicketUseCase,
  EntityHistoryUseCase,
  GetTicketUseCase,
  ListAuditLogsUseCase,
  ListTicketsUseCase,
  ReplyToTicketUseCase,
  TicketAccessService,
  TicketQueueSummaryUseCase,
} from './application/use-cases/support.use-cases';
import { AdminContentController } from './content.controller';
import {
  AuditLogRepository,
  BannerRepository,
  CouponRepository,
  DashboardRepository,
  SettingRepository,
  SupportTicketRepository,
} from './domain/repositories/admin.repository';
import { AuditInterceptor } from './infrastructure/audit.interceptor';
import { PrismaDashboardRepository } from './infrastructure/repositories/prisma-dashboard.repository';
import {
  PrismaBannerRepository,
  PrismaCouponRepository,
  PrismaSettingRepository,
} from './infrastructure/repositories/prisma-content.repository';
import {
  PrismaAuditLogRepository,
  PrismaSupportTicketRepository,
} from './infrastructure/repositories/prisma-support.repository';
import { AuditLogController, SupportController } from './support.controller';

@Module({
  // Imports nothing. The admin surface reads across every domain, and importing
  // the modules it reports on would make the graph a knot — so it queries the
  // database directly through its own repositories instead. Users, restaurants,
  // orders and payments keep their own admin routes; this module adds what none
  // of them owns: the dashboard, reports, promotions, configuration, support
  // and the audit trail.
  controllers: [
    AdminDashboardController,
    AdminContentController,
    SupportController,
    AuditLogController,
  ],
  providers: [
    DashboardUseCase,
    SalesReportUseCase,
    LeaderboardUseCase,
    OperationsReportUseCase,

    ListCouponsUseCase,
    GetCouponUseCase,
    CreateCouponUseCase,
    UpdateCouponUseCase,
    SetCouponActiveUseCase,
    DeleteCouponUseCase,

    ListBannersUseCase,
    CreateBannerUseCase,
    UpdateBannerUseCase,
    DeleteBannerUseCase,
    ReorderBannersUseCase,

    ListSettingsUseCase,
    UpsertSettingsUseCase,
    DeleteSettingUseCase,

    TicketAccessService,
    CreateTicketUseCase,
    ListTicketsUseCase,
    GetTicketUseCase,
    ReplyToTicketUseCase,
    ChangeTicketStatusUseCase,
    AssignTicketUseCase,
    ChangeTicketPriorityUseCase,
    TicketQueueSummaryUseCase,

    ListAuditLogsUseCase,
    EntityHistoryUseCase,
    AuditFacetsUseCase,

    { provide: DashboardRepository, useClass: PrismaDashboardRepository },
    { provide: CouponRepository, useClass: PrismaCouponRepository },
    { provide: BannerRepository, useClass: PrismaBannerRepository },
    { provide: SettingRepository, useClass: PrismaSettingRepository },
    { provide: SupportTicketRepository, useClass: PrismaSupportTicketRepository },
    { provide: AuditLogRepository, useClass: PrismaAuditLogRepository },

    // Registered globally from here rather than in CommonModule, because the
    // audit log is an admin concern and this is the module that owns the table
    // it writes to. Nest applies an APP_INTERCEPTOR from wherever it is
    // declared, so the reach is global while the ownership stays local.
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
  exports: [AuditLogRepository],
})
export class AdminModule {}
