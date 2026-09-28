import { RiderSettlementDirection, UserRole } from '@prisma/client';

import { ResourceNotFoundException } from '@/common/exceptions/domain.exception';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import type { RestaurantRepository } from '@/modules/restaurants/domain/repositories/restaurant.repository';

import type { RiderFinanceRepository } from '../../domain/repositories/rider-finance.repository';
import type { RiderAccessService } from './rider-profile.use-cases';
import { RestaurantSettlementUseCases, RiderSettlementUseCases } from './settlement.use-cases';

const RIDER: AuthenticatedUser = {
  id: 'user-1',
  phone: '+923005551234',
  role: UserRole.RIDER,
  permissions: [],
  staffRestaurantId: null,
  sessionId: 'session-1',
};

const OWNER: AuthenticatedUser = {
  id: 'owner-1',
  phone: '+923000000002',
  role: UserRole.VENDOR_OWNER,
  permissions: [],
  staffRestaurantId: null,
  sessionId: 'session-2',
};

const OTHER_OWNER: AuthenticatedUser = { ...OWNER, id: 'owner-2' };

function settlement(direction: RiderSettlementDirection) {
  return {
    id: 'settlement-1',
    driverId: 'rider-1',
    restaurantId: 'restaurant-1',
    direction,
    amount: 500,
    note: null,
    recordedById: 'someone',
    createdAt: new Date(),
    restaurant: { name: 'Chapli Kabab House' },
    driver: { user: { fullName: 'Bilal Ahmed' } },
    recordedBy: { fullName: 'Someone' },
  };
}

function build() {
  const finance = {
    recordSettlement: jest
      .fn()
      .mockImplementation((input: { direction: RiderSettlementDirection }) =>
        Promise.resolve(settlement(input.direction)),
      ),
    balancesForRestaurant: jest.fn().mockResolvedValue([]),
  } as unknown as jest.Mocked<RiderFinanceRepository>;

  const access = {
    mine: jest.fn().mockResolvedValue({ id: 'rider-1', userId: 'user-1' }),
  } as unknown as jest.Mocked<RiderAccessService>;

  const restaurants = {
    findById: jest.fn().mockResolvedValue({ id: 'restaurant-1', ownerId: 'owner-1' }),
  } as unknown as jest.Mocked<RestaurantRepository>;

  return { finance, access, restaurants };
}

describe('RiderSettlementUseCases.recordFeesReceived', () => {
  it('records fees the business paid, against the calling rider', async () => {
    const { finance, access } = build();
    const useCase = new RiderSettlementUseCases(finance, access);

    const result = await useCase.recordFeesReceived(RIDER, {
      restaurantId: 'restaurant-1',
      amount: 500,
    });

    expect(finance.recordSettlement).toHaveBeenCalledWith({
      driverId: 'rider-1',
      restaurantId: 'restaurant-1',
      direction: RiderSettlementDirection.RESTAURANT_TO_RIDER,
      amount: 500,
      note: null,
      recordedById: 'user-1',
    });
    expect(result.direction).toBe(RiderSettlementDirection.RESTAURANT_TO_RIDER);
  });
});

describe('RestaurantSettlementUseCases.recordCashReceived', () => {
  it('records cash a rider handed over, for the owner’s own business', async () => {
    const { finance, restaurants } = build();
    const useCase = new RestaurantSettlementUseCases(finance, restaurants);

    await useCase.recordCashReceived('restaurant-1', OWNER, {
      driverId: 'rider-1',
      amount: 500,
      note: 'Counter',
    });

    expect(finance.recordSettlement).toHaveBeenCalledWith({
      driverId: 'rider-1',
      restaurantId: 'restaurant-1',
      direction: RiderSettlementDirection.RIDER_TO_RESTAURANT,
      amount: 500,
      note: 'Counter',
      recordedById: 'owner-1',
    });
  });

  it('hides another vendor’s business behind a 404', async () => {
    const { finance, restaurants } = build();
    const useCase = new RestaurantSettlementUseCases(finance, restaurants);

    await expect(
      useCase.recordCashReceived('restaurant-1', OTHER_OWNER, { driverId: 'rider-1', amount: 1 }),
    ).rejects.toThrow(ResourceNotFoundException);
    await expect(useCase.balances('restaurant-1', OTHER_OWNER)).rejects.toThrow(
      ResourceNotFoundException,
    );
    expect(finance.recordSettlement).not.toHaveBeenCalled();
    expect(finance.balancesForRestaurant).not.toHaveBeenCalled();
  });
});
