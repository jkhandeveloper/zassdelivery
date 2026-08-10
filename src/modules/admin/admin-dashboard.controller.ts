import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { RequirePermissions } from '@/common/decorators/permissions.decorator';
import { ApiErrorResponseDto } from '@/common/dto/api-response.dto';

import {
  CancellationReportRowDto,
  CouponReportRowDto,
  DashboardDto,
  LeaderboardRowDto,
  SalesReportDto,
  ZoneReportRowDto,
} from './application/dto/admin-response.dto';
import { LeaderboardQueryDto, ReportWindowDto } from './application/dto/admin.dto';
import {
  DashboardUseCase,
  LeaderboardUseCase,
  OperationsReportUseCase,
  SalesReportUseCase,
} from './application/use-cases/dashboard.use-cases';

/**
 * The operations view of the whole platform.
 *
 * Everything here is `analytics.read`, which is deliberately a lower bar than
 * the permissions that change things: an operations lead should be able to see
 * how the business is doing without also being able to refund an order.
 */
@ApiTags('Admin Dashboard')
@ApiBearerAuth('access-token')
@ApiResponse({ status: 401, description: 'Not authenticated.', type: ApiErrorResponseDto })
@ApiResponse({ status: 403, description: 'Not permitted.', type: ApiErrorResponseDto })
@Controller('admin')
export class AdminDashboardController {
  constructor(
    private readonly dashboard: DashboardUseCase,
    private readonly sales: SalesReportUseCase,
    private readonly leaderboard: LeaderboardUseCase,
    private readonly operations: OperationsReportUseCase,
  ) {}

  @Get('dashboard')
  @RequirePermissions('analytics.read')
  @ApiOperation({
    summary: 'The operations dashboard',
    description:
      'Today’s numbers, the work waiting on somebody, who is working right now, ' +
      'and a fortnight of trend — in one response, because a dashboard that ' +
      'makes six calls renders in six stages. `actionsRequired` is the single ' +
      'number that says whether anything needs a person.',
  })
  @ApiResponse({ status: 200, type: DashboardDto })
  overview(): Promise<DashboardDto> {
    return this.dashboard.execute();
  }

  @Get('reports/sales')
  @RequirePermissions('analytics.read')
  @ApiOperation({
    summary: 'Sales over a window',
    description:
      'Defaults to the last 30 days. Revenue counts orders that were paid for ' +
      'or will be — cancellations are excluded, because counting them would ' +
      'flatter every figure on the page, and the flattery grows with the ' +
      'failure rate.',
  })
  @ApiResponse({ status: 200, type: SalesReportDto })
  salesReport(@Query() query: ReportWindowDto): Promise<SalesReportDto> {
    return this.sales.execute(query);
  }

  @Get('reports/restaurants')
  @RequirePermissions('analytics.read')
  @ApiOperation({ summary: 'Best-performing restaurants', description: 'By revenue.' })
  @ApiResponse({ status: 200, type: [LeaderboardRowDto] })
  topRestaurants(@Query() query: LeaderboardQueryDto): Promise<LeaderboardRowDto[]> {
    return this.leaderboard.restaurants(query);
  }

  @Get('reports/riders')
  @RequirePermissions('analytics.read')
  @ApiOperation({
    summary: 'Busiest riders',
    description: 'By completed deliveries. `revenue` here is what the rider earned.',
  })
  @ApiResponse({ status: 200, type: [LeaderboardRowDto] })
  topRiders(@Query() query: LeaderboardQueryDto): Promise<LeaderboardRowDto[]> {
    return this.leaderboard.riders(query);
  }

  @Get('reports/customers')
  @RequirePermissions('analytics.read')
  @ApiOperation({ summary: 'Highest-spending customers' })
  @ApiResponse({ status: 200, type: [LeaderboardRowDto] })
  topCustomers(@Query() query: LeaderboardQueryDto): Promise<LeaderboardRowDto[]> {
    return this.leaderboard.customers(query);
  }

  @Get('reports/zones')
  @RequirePermissions('analytics.read')
  @ApiOperation({
    summary: 'Orders and revenue by zone',
    description: 'Where the demand actually is, so expansion is decided on evidence.',
  })
  @ApiResponse({ status: 200, type: [ZoneReportRowDto] })
  byZone(@Query() query: ReportWindowDto): Promise<ZoneReportRowDto[]> {
    return this.operations.byZone(query);
  }

  @Get('reports/coupons')
  @RequirePermissions('analytics.read')
  @ApiOperation({
    summary: 'What the discounts cost',
    description: 'Redemptions and money given away, per campaign.',
  })
  @ApiResponse({ status: 200, type: [CouponReportRowDto] })
  couponReport(@Query() query: ReportWindowDto): Promise<CouponReportRowDto[]> {
    return this.operations.coupons(query);
  }

  @Get('reports/cancellations')
  @RequirePermissions('analytics.read')
  @ApiOperation({
    summary: 'What went wrong, and whose decision it was',
    description:
      'Split by actor deliberately: a customer changing their mind and a ' +
      'kitchen rejecting orders it cannot cook are the same number on a chart ' +
      'and entirely different problems to fix.',
  })
  @ApiResponse({ status: 200, type: [CancellationReportRowDto] })
  cancellations(@Query() query: ReportWindowDto): Promise<CancellationReportRowDto[]> {
    return this.operations.cancellations(query);
  }
}
