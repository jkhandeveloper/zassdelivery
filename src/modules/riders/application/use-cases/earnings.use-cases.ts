import { Injectable } from '@nestjs/common';

import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import type { PaginatedResult } from '@/common/interfaces/paginated-result.interface';
import { buildOrderBy } from '@/common/utils/pagination.util';

import { RiderFinanceRepository } from '../../domain/repositories/rider-finance.repository';
import { toEarningDto, type EarningDto, type EarningsSummaryDto } from '../dto/rider-response.dto';
import { EARNING_SORT_FIELDS, type ListEarningsQueryDto } from '../dto/rider.dto';
import { RiderAccessService } from './rider-profile.use-cases';

@Injectable()
export class ListEarningsUseCase {
  constructor(
    private readonly finance: RiderFinanceRepository,
    private readonly access: RiderAccessService,
  ) {}

  async execute(
    actor: AuthenticatedUser,
    query: ListEarningsQueryDto,
  ): Promise<PaginatedResult<EarningDto>> {
    const rider = await this.access.mine(actor);
    const orderBy = buildOrderBy(query.sortBy, query.sortOrder, EARNING_SORT_FIELDS, 'earnedAt');

    const result = await this.finance.listEarnings({
      page: query.page,
      limit: query.limit,
      orderBy,
      driverId: rider.id,
      from: query.from,
      to: query.to,
    });

    return { items: result.items.map(toEarningDto), meta: result.meta };
  }
}

@Injectable()
export class EarningsSummaryUseCase {
  constructor(
    private readonly finance: RiderFinanceRepository,
    private readonly access: RiderAccessService,
  ) {}

  /** The header on the rider's earnings screen: today, this week, this month. */
  async execute(actor: AuthenticatedUser): Promise<EarningsSummaryDto> {
    const rider = await this.access.mine(actor);
    const summary = await this.finance.summarise(rider.id, new Date());

    return {
      ...summary,
      averagePerDelivery:
        summary.deliveriesLifetime === 0
          ? 0
          : Math.round((summary.lifetime / summary.deliveriesLifetime) * 100) / 100,
    };
  }
}
