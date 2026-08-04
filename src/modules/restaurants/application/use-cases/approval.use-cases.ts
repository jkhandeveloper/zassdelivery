import { Injectable } from '@nestjs/common';
import { RestaurantStatus } from '@prisma/client';

import {
  BusinessRuleViolationException,
  ResourceNotFoundException,
} from '@/common/exceptions/domain.exception';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';

import { RestaurantRepository } from '../../domain/repositories/restaurant.repository';
import { toRestaurantDto, type RestaurantAdminDto } from '../dto/restaurant-response.dto';
import type {
  ChangeRestaurantStatusDto,
  RejectRestaurantDto,
  SetAcceptingOrdersDto,
} from '../dto/restaurant.dto';
import { assertCanManage } from './restaurants.use-cases';

/**
 * Legal transitions in the approval workflow.
 *
 * Encoded as data rather than scattered `if` statements so the whole lifecycle
 * is readable in one place — and so an illegal jump (rejected straight to
 * active, say, skipping re-review) fails loudly instead of silently corrupting
 * the queue.
 */
const ALLOWED_TRANSITIONS: Record<RestaurantStatus, RestaurantStatus[]> = {
  [RestaurantStatus.PENDING_APPROVAL]: [RestaurantStatus.ACTIVE, RestaurantStatus.REJECTED],
  [RestaurantStatus.ACTIVE]: [RestaurantStatus.SUSPENDED, RestaurantStatus.TEMPORARILY_CLOSED],
  [RestaurantStatus.TEMPORARILY_CLOSED]: [RestaurantStatus.ACTIVE, RestaurantStatus.SUSPENDED],
  [RestaurantStatus.SUSPENDED]: [RestaurantStatus.ACTIVE, RestaurantStatus.REJECTED],
  // A rejected listing goes back to the queue for another look; it never jumps
  // straight to live without a second review.
  [RestaurantStatus.REJECTED]: [RestaurantStatus.PENDING_APPROVAL],
};

function assertTransition(from: RestaurantStatus, to: RestaurantStatus): void {
  if (from === to) {
    throw new BusinessRuleViolationException(`The restaurant is already ${from}.`);
  }

  if (!ALLOWED_TRANSITIONS[from].includes(to)) {
    throw new BusinessRuleViolationException(
      `A restaurant cannot move from ${from} to ${to}. Allowed: ${ALLOWED_TRANSITIONS[from].join(', ') || 'none'}.`,
    );
  }
}

@Injectable()
export class ApproveRestaurantUseCase {
  constructor(private readonly restaurants: RestaurantRepository) {}

  async execute(id: string, reviewerId: string): Promise<RestaurantAdminDto> {
    const existing = await this.restaurants.findById(id, true);

    if (!existing) {
      throw new ResourceNotFoundException('Restaurant', id);
    }

    assertTransition(existing.status, RestaurantStatus.ACTIVE);

    // A listing with no opening hours would be permanently "closed" the moment
    // it went live, so approval is blocked until the owner sets them.
    const hours = await this.restaurants.findHours(id);

    if (hours.length === 0 || hours.every((hour) => hour.isClosed)) {
      throw new BusinessRuleViolationException(
        'Business hours must be set before this restaurant can be approved.',
      );
    }

    const updated = await this.restaurants.setStatus(id, RestaurantStatus.ACTIVE, {
      approvedById: reviewerId,
    });

    return toRestaurantDto(updated, { includePrivate: true }) as RestaurantAdminDto;
  }
}

@Injectable()
export class RejectRestaurantUseCase {
  constructor(private readonly restaurants: RestaurantRepository) {}

  async execute(
    id: string,
    dto: RejectRestaurantDto,
    reviewerId: string,
  ): Promise<RestaurantAdminDto> {
    const existing = await this.restaurants.findById(id, true);

    if (!existing) {
      throw new ResourceNotFoundException('Restaurant', id);
    }

    assertTransition(existing.status, RestaurantStatus.REJECTED);

    const updated = await this.restaurants.setStatus(id, RestaurantStatus.REJECTED, {
      approvedById: reviewerId,
      rejectionReason: dto.reason,
    });

    return toRestaurantDto(updated, { includePrivate: true }) as RestaurantAdminDto;
  }
}

@Injectable()
export class ResubmitRestaurantUseCase {
  constructor(private readonly restaurants: RestaurantRepository) {}

  /** Puts a rejected listing back in the review queue after the owner fixes it. */
  async execute(id: string, actor: AuthenticatedUser): Promise<RestaurantAdminDto> {
    const existing = await this.restaurants.findById(id, true);

    if (!existing) {
      throw new ResourceNotFoundException('Restaurant', id);
    }

    assertCanManage(existing, actor);
    assertTransition(existing.status, RestaurantStatus.PENDING_APPROVAL);

    const updated = await this.restaurants.setStatus(id, RestaurantStatus.PENDING_APPROVAL, {});

    return toRestaurantDto(updated, { includePrivate: true }) as RestaurantAdminDto;
  }
}

@Injectable()
export class ChangeRestaurantStatusUseCase {
  constructor(private readonly restaurants: RestaurantRepository) {}

  /** Staff override for suspend, reinstate and temporary closure. */
  async execute(
    id: string,
    dto: ChangeRestaurantStatusDto,
    reviewerId: string,
  ): Promise<RestaurantAdminDto> {
    const existing = await this.restaurants.findById(id, true);

    if (!existing) {
      throw new ResourceNotFoundException('Restaurant', id);
    }

    assertTransition(existing.status, dto.status);

    const updated = await this.restaurants.setStatus(id, dto.status, {
      approvedById: reviewerId,
      rejectionReason: dto.reason,
    });

    return toRestaurantDto(updated, { includePrivate: true }) as RestaurantAdminDto;
  }
}

@Injectable()
export class SetAcceptingOrdersUseCase {
  constructor(private readonly restaurants: RestaurantRepository) {}

  /**
   * The owner's "pause orders" switch — for a broken oven or an unexpected rush.
   * Kept separate from `status` so pausing does not disturb the approval trail.
   */
  async execute(
    id: string,
    dto: SetAcceptingOrdersDto,
    actor: AuthenticatedUser,
  ): Promise<RestaurantAdminDto> {
    const existing = await this.restaurants.findById(id);

    if (!existing) {
      throw new ResourceNotFoundException('Restaurant', id);
    }

    assertCanManage(existing, actor);

    if (existing.status !== RestaurantStatus.ACTIVE && dto.isAcceptingOrders) {
      throw new BusinessRuleViolationException(
        `A restaurant that is ${existing.status} cannot start accepting orders.`,
      );
    }

    const updated = await this.restaurants.setAcceptingOrders(id, dto.isAcceptingOrders);

    return toRestaurantDto(updated, { includePrivate: true }) as RestaurantAdminDto;
  }
}
