import { Injectable } from '@nestjs/common';
import { RiderSettlementDirection } from '@prisma/client';

import { ResourceNotFoundException } from '@/common/exceptions/domain.exception';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import type { PaginatedResult } from '@/common/interfaces/paginated-result.interface';
import { RestaurantRepository } from '@/modules/restaurants/domain/repositories/restaurant.repository';
import { assertCanManage } from '@/modules/restaurants/application/use-cases/restaurants.use-cases';

import { RiderFinanceRepository } from '../../domain/repositories/rider-finance.repository';
import {
  toLedgerEntryDto,
  toRestaurantBalanceDto,
  toRiderBalanceDto,
  toSettlementDto,
  type RestaurantBalanceDto,
  type RiderBalanceDto,
  type RiderLedgerEntryDto,
  type RiderSettlementDto,
} from '../dto/rider-response.dto';
import type {
  ListSettlementQueryDto,
  RecordCashReceivedDto,
  RecordFeesReceivedDto,
} from '../dto/rider.dto';
import { RiderAccessService } from './rider-profile.use-cases';

/**
 * The rider's side of the money they and the restaurants owe each other.
 *
 * The platform never holds order money. A rider who collected cash owes the
 * restaurant everything but their fee; a restaurant that was paid directly owes
 * the rider their fee. These use cases only keep score of that.
 */
@Injectable()
export class RiderSettlementUseCases {
  constructor(
    private readonly finance: RiderFinanceRepository,
    private readonly access: RiderAccessService,
  ) {}

  async balances(actor: AuthenticatedUser): Promise<RestaurantBalanceDto[]> {
    const rider = await this.access.mine(actor);

    return (await this.finance.balancesForRider(rider.id)).map(toRestaurantBalanceDto);
  }

  async entries(
    actor: AuthenticatedUser,
    query: ListSettlementQueryDto,
  ): Promise<PaginatedResult<RiderLedgerEntryDto>> {
    const rider = await this.access.mine(actor);
    const result = await this.finance.listLedgerEntries({
      driverId: rider.id,
      restaurantId: query.restaurantId,
      page: query.page,
      limit: query.limit,
    });

    return { items: result.items.map(toLedgerEntryDto), meta: result.meta };
  }

  async settlements(
    actor: AuthenticatedUser,
    query: ListSettlementQueryDto,
  ): Promise<PaginatedResult<RiderSettlementDto>> {
    const rider = await this.access.mine(actor);
    const result = await this.finance.listSettlements({
      driverId: rider.id,
      restaurantId: query.restaurantId,
      page: query.page,
      limit: query.limit,
    });

    return { items: result.items.map(toSettlementDto), meta: result.meta };
  }

  /**
   * The rider confirms a restaurant paid them their fees.
   *
   * Only the rider can record this, because only the person the money reached
   * can say it arrived. The restaurant saying "we paid" is exactly the claim
   * this step exists to check.
   */
  async recordFeesReceived(
    actor: AuthenticatedUser,
    dto: RecordFeesReceivedDto,
  ): Promise<RiderSettlementDto> {
    const rider = await this.access.mine(actor);

    return toSettlementDto(
      await this.finance.recordSettlement({
        driverId: rider.id,
        restaurantId: dto.restaurantId,
        direction: RiderSettlementDirection.RESTAURANT_TO_RIDER,
        amount: dto.amount,
        note: dto.note ?? null,
        recordedById: actor.id,
      }),
    );
  }
}

/** The restaurant's side: which riders owe it cash, and whom it owes fees. */
@Injectable()
export class RestaurantSettlementUseCases {
  constructor(
    private readonly finance: RiderFinanceRepository,
    private readonly restaurants: RestaurantRepository,
  ) {}

  async balances(restaurantId: string, actor: AuthenticatedUser): Promise<RiderBalanceDto[]> {
    await this.assertAccess(restaurantId, actor);

    return (await this.finance.balancesForRestaurant(restaurantId)).map(toRiderBalanceDto);
  }

  async entries(
    restaurantId: string,
    actor: AuthenticatedUser,
    query: ListSettlementQueryDto,
  ): Promise<PaginatedResult<RiderLedgerEntryDto>> {
    await this.assertAccess(restaurantId, actor);

    const result = await this.finance.listLedgerEntries({
      restaurantId,
      driverId: query.driverId,
      page: query.page,
      limit: query.limit,
    });

    return { items: result.items.map(toLedgerEntryDto), meta: result.meta };
  }

  async settlements(
    restaurantId: string,
    actor: AuthenticatedUser,
    query: ListSettlementQueryDto,
  ): Promise<PaginatedResult<RiderSettlementDto>> {
    await this.assertAccess(restaurantId, actor);

    const result = await this.finance.listSettlements({
      restaurantId,
      driverId: query.driverId,
      page: query.page,
      limit: query.limit,
    });

    return { items: result.items.map(toSettlementDto), meta: result.meta };
  }

  /**
   * The restaurant confirms a rider handed over the order money they collected.
   *
   * Staff may record it as well as the owner: the cash usually changes hands at
   * the counter, and the person who counted it is the one who should say so.
   */
  async recordCashReceived(
    restaurantId: string,
    actor: AuthenticatedUser,
    dto: RecordCashReceivedDto,
  ): Promise<RiderSettlementDto> {
    await this.assertAccess(restaurantId, actor);

    return toSettlementDto(
      await this.finance.recordSettlement({
        driverId: dto.driverId,
        restaurantId,
        direction: RiderSettlementDirection.RIDER_TO_RESTAURANT,
        amount: dto.amount,
        note: dto.note ?? null,
        recordedById: actor.id,
      }),
    );
  }

  private async assertAccess(restaurantId: string, actor: AuthenticatedUser): Promise<void> {
    const restaurant = await this.restaurants.findById(restaurantId);

    if (restaurant === null) {
      throw new ResourceNotFoundException('Business', restaurantId);
    }

    assertCanManage(restaurant, actor);
  }
}
