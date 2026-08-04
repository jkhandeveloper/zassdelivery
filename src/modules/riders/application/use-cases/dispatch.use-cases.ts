import { Injectable } from '@nestjs/common';
import { AssignmentStatus, DriverStatus, OrderStatus } from '@prisma/client';

import {
  BusinessRuleViolationException,
  ResourceNotFoundException,
} from '@/common/exceptions/domain.exception';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import type { PaginatedResult } from '@/common/interfaces/paginated-result.interface';
import { buildOrderBy } from '@/common/utils/pagination.util';
import { OrderRepository } from '@/modules/orders/domain/repositories/order.repository';

import {
  AssignmentRepository,
  type AssignmentWithOrder,
} from '../../domain/repositories/assignment.repository';
import { DeliveryNotificationPort } from '../../domain/repositories/delivery-notification.port';
import { RiderRepository, type RiderWithDetails } from '../../domain/repositories/rider.repository';
import { DispatchService } from '../../domain/services/dispatch.service';
import { EarningsCalculator } from '../../domain/services/earnings.calculator';
import { RiderLifecycle } from '../../domain/services/rider-lifecycle';
import { toAssignmentDto, type AssignmentDto } from '../dto/rider-response.dto';
import {
  ASSIGNMENT_SORT_FIELDS,
  type AssignOrderDto,
  type CancelAssignmentDto,
  type ListAssignmentsQueryDto,
  type RejectOfferDto,
} from '../dto/rider.dto';
import { RiderSettingsService } from '../services/rider-settings.service';
import { RiderAccessService } from './rider-profile.use-cases';

/**
 * Statuses at which an order is ready to be given to a rider.
 *
 * Dispatch starts at CONFIRMED rather than READY_FOR_PICKUP so a rider can be
 * riding to the restaurant while the food is still cooking — waiting until the
 * order is ready would add the whole travel time to every delivery.
 */
const DISPATCHABLE_STATUSES: OrderStatus[] = [
  OrderStatus.CONFIRMED,
  OrderStatus.PREPARING,
  OrderStatus.READY_FOR_PICKUP,
];

@Injectable()
export class AssignOrderUseCase {
  constructor(
    private readonly assignments: AssignmentRepository,
    private readonly riders: RiderRepository,
    private readonly orders: OrderRepository,
    private readonly dispatch: DispatchService,
    private readonly earnings: EarningsCalculator,
    private readonly settings: RiderSettingsService,
  ) {}

  /**
   * Offers an order to a rider — either the one an operator named, or whoever
   * the dispatcher ranks highest.
   *
   * The result is an *offer*, not an assignment: the rider still has to accept
   * it. Pushing an order onto a rider who is stuck in traffic or has already
   * gone home produces an order that nobody is actually carrying, which is
   * worse than an unassigned one because it looks handled.
   */
  async execute(
    orderId: string,
    dto: AssignOrderDto,
    actor: AuthenticatedUser,
  ): Promise<AssignmentDto> {
    const order = await this.orders.findById(orderId);

    if (!order) {
      throw new ResourceNotFoundException('Order', orderId);
    }

    if (!DISPATCHABLE_STATUSES.includes(order.status)) {
      throw new BusinessRuleViolationException(
        `An order that is ${order.status} cannot be dispatched. It must be confirmed by the restaurant first.`,
      );
    }

    if (order.driverId !== null) {
      throw new BusinessRuleViolationException(
        'This order already has a rider. Cancel that assignment before reassigning it.',
      );
    }

    const dispatchSettings = await this.settings.dispatch();
    const rates = await this.settings.earningRates();

    const pickupLat = order.restaurant.latitude;
    const pickupLng = order.restaurant.longitude;

    const chosen =
      dto.driverId === undefined
        ? await this.autoSelect(order.id, order.zoneId, pickupLat, pickupLng, dispatchSettings)
        : await this.named(dto.driverId, pickupLat, pickupLng, dispatchSettings);

    const timeoutSeconds = dto.timeoutSeconds ?? dispatchSettings.offerTimeoutSeconds;

    return toAssignmentDto(
      await this.assignments.offer({
        orderId: order.id,
        driverId: chosen.driverId,
        expiresAt: new Date(Date.now() + timeoutSeconds * 1000),
        pickupDistanceKm: chosen.pickupDistanceKm,
        estimatedEarning: this.earnings.quote(
          order.distanceKm === null ? null : Number(order.distanceKm),
          rates,
        ),
        assignedById: dto.driverId === undefined ? null : actor.id,
        isAuto: dto.driverId === undefined,
      }),
    );
  }

  private async autoSelect(
    orderId: string,
    zoneId: string,
    pickupLat: number,
    pickupLng: number,
    dispatchSettings: { searchRadiusKm: number; locationFreshnessMinutes: number },
  ): Promise<{ driverId: string; pickupDistanceKm: number | null }> {
    const candidates = await this.riders.findDispatchCandidates(orderId);

    const best = this.dispatch.pick(candidates, pickupLat, pickupLng, {
      searchRadiusKm: dispatchSettings.searchRadiusKm,
      locationFreshnessMinutes: dispatchSettings.locationFreshnessMinutes,
      orderZoneId: zoneId,
    });

    if (!best) {
      throw new BusinessRuleViolationException(
        'No rider is available for this order right now. Try again shortly, or assign one by hand.',
      );
    }

    return { driverId: best.driverId, pickupDistanceKm: best.pickupDistanceKm };
  }

  private async named(
    driverId: string,
    pickupLat: number,
    pickupLng: number,
    dispatchSettings: { locationFreshnessMinutes: number },
  ): Promise<{ driverId: string; pickupDistanceKm: number | null }> {
    const rider = await this.riders.findById(driverId);

    if (!rider) {
      throw new ResourceNotFoundException('Rider', driverId);
    }

    if (rider.status !== DriverStatus.ACTIVE) {
      throw new BusinessRuleViolationException(
        `This rider is ${rider.status.toLowerCase()} and cannot be given deliveries.`,
      );
    }

    if (!RiderLifecycle.canReceiveOffers(rider.status, rider.availability)) {
      throw new BusinessRuleViolationException(
        `This rider is ${rider.availability.toLowerCase().replace('_', ' ')} and cannot take another delivery.`,
      );
    }

    // A hand-picked rider is offered the run wherever they are — an operator
    // assigning by name has a reason the ranking cannot see — but the distance
    // is still quoted so the rider knows what they are agreeing to.
    const ranked = this.dispatch.rank(
      [
        {
          driverId: rider.id,
          zoneId: rider.zoneId,
          currentLat: rider.currentLat,
          currentLng: rider.currentLng,
          lastLocationAt: rider.lastLocationAt,
          rating: Number(rider.rating),
          hasRejectedThisOrder: false,
        },
      ],
      pickupLat,
      pickupLng,
      {
        searchRadiusKm: Number.POSITIVE_INFINITY,
        locationFreshnessMinutes: dispatchSettings.locationFreshnessMinutes,
        orderZoneId: rider.zoneId ?? '',
      },
    );

    return { driverId: rider.id, pickupDistanceKm: ranked[0]?.pickupDistanceKm ?? null };
  }
}

@Injectable()
export class ListAssignmentsUseCase {
  constructor(private readonly assignments: AssignmentRepository) {}

  async execute(
    query: ListAssignmentsQueryDto,
    scope: { driverId?: string; orderId?: string } = {},
  ): Promise<PaginatedResult<AssignmentDto>> {
    const orderBy = buildOrderBy(
      query.sortBy,
      query.sortOrder,
      ASSIGNMENT_SORT_FIELDS,
      'offeredAt',
    );

    const result = await this.assignments.findMany({
      page: query.page,
      limit: query.limit,
      orderBy,
      driverId: scope.driverId,
      orderId: scope.orderId,
      status: query.status,
      liveOnly: query.liveOnly,
      from: query.from,
      to: query.to,
    });

    return {
      items: result.items.map((assignment) => toAssignmentDto(assignment)),
      meta: result.meta,
    };
  }
}

/**
 * Loads an assignment and checks it belongs to the calling rider.
 *
 * Shared by every rider-facing action on an offer or a delivery, so no route
 * can forget it and let one rider answer another's offer.
 */
@Injectable()
export class AssignmentAccessService {
  constructor(
    private readonly assignments: AssignmentRepository,
    private readonly access: RiderAccessService,
  ) {}

  async forRider(assignmentId: string, actor: AuthenticatedUser): Promise<RiderAssignment> {
    const rider = await this.access.approved(actor);
    const assignment = await this.assignments.findById(assignmentId);

    // 404 rather than 403 for someone else's offer: confirming that the id
    // exists would itself tell a rider what other work is out there.
    if (!assignment || assignment.driverId !== rider.id) {
      throw new ResourceNotFoundException('Assignment', assignmentId);
    }

    return { assignment, rider };
  }

  /** The rider's live assignment for an order, however they reached the route. */
  async forOrder(orderId: string, actor: AuthenticatedUser): Promise<RiderAssignment> {
    const rider = await this.access.approved(actor);
    const assignment = await this.assignments.findForOrderAndDriver(orderId, rider.id);

    if (!assignment) {
      throw new ResourceNotFoundException('Delivery', orderId);
    }

    return { assignment, rider };
  }
}

/** An assignment paired with the rider it belongs to. */
export interface RiderAssignment {
  assignment: AssignmentWithOrder;
  rider: RiderWithDetails;
}

@Injectable()
export class AcceptOfferUseCase {
  constructor(
    private readonly assignments: AssignmentRepository,
    private readonly access: AssignmentAccessService,
    private readonly notifications: DeliveryNotificationPort,
  ) {}

  /**
   * Takes the run.
   *
   * The order gains its rider, the rider moves to ON_DELIVERY and the customer
   * is told who is bringing their food — all inside one transaction in the
   * repository, because a rider who has accepted an order that does not know
   * about them is the hardest kind of inconsistency to notice.
   */
  async execute(assignmentId: string, actor: AuthenticatedUser): Promise<AssignmentDto> {
    const { assignment, rider } = await this.access.forRider(assignmentId, actor);

    DispatchService.assertAnswerable(assignment.status, assignment.expiresAt);

    const accepted = await this.assignments.accept(assignmentId);

    await this.notifications.sendRiderAssigned({
      customerId: accepted.order.customerId,
      orderId: accepted.order.id,
      orderNumber: accepted.order.orderNumber,
      riderName: rider.user.fullName,
      riderPhone: rider.user.phone,
    });

    return toAssignmentDto(accepted, { revealCustomer: true });
  }
}

@Injectable()
export class RejectOfferUseCase {
  constructor(
    private readonly assignments: AssignmentRepository,
    private readonly access: AssignmentAccessService,
  ) {}

  /**
   * Declines the run and frees the order for someone else.
   *
   * The rejection is kept rather than deleted: it is the record of why an order
   * sat unassigned, and it stops the dispatcher immediately re-offering the
   * same run to the rider who just said no.
   */
  async execute(
    assignmentId: string,
    dto: RejectOfferDto,
    actor: AuthenticatedUser,
  ): Promise<AssignmentDto> {
    const { assignment } = await this.access.forRider(assignmentId, actor);

    DispatchService.assertAnswerable(assignment.status, assignment.expiresAt);

    return toAssignmentDto(await this.assignments.reject(assignmentId, dto.reason ?? null));
  }
}

@Injectable()
export class CancelAssignmentUseCase {
  constructor(private readonly assignments: AssignmentRepository) {}

  /**
   * Withdraws an offer or an acceptance from the dispatch side.
   *
   * Refused once the rider has the food: an order already collected has to be
   * delivered or explicitly failed, not quietly detached from the rider
   * carrying it.
   */
  async execute(assignmentId: string, dto: CancelAssignmentDto): Promise<AssignmentDto> {
    const assignment = await this.assignments.findById(assignmentId);

    if (!assignment) {
      throw new ResourceNotFoundException('Assignment', assignmentId);
    }

    if (
      assignment.status !== AssignmentStatus.OFFERED &&
      assignment.status !== AssignmentStatus.ACCEPTED
    ) {
      throw new BusinessRuleViolationException(
        `This assignment is ${assignment.status.toLowerCase()} and can no longer be cancelled.`,
      );
    }

    if (
      assignment.order.status === OrderStatus.PICKED_UP ||
      assignment.order.status === OrderStatus.ON_THE_WAY
    ) {
      throw new BusinessRuleViolationException(
        'The rider is already carrying this order. Mark the delivery failed instead.',
      );
    }

    return toAssignmentDto(await this.assignments.cancel(assignmentId, dto.reason));
  }
}

@Injectable()
export class ExpireOffersUseCase {
  constructor(private readonly assignments: AssignmentRepository) {}

  /**
   * Sweeps up offers nobody answered.
   *
   * Called from the dispatch board rather than a scheduler for now — the
   * acceptance path re-checks the deadline itself, so a late sweep can never
   * let an expired offer be accepted; it only tidies the queue.
   */
  async execute(): Promise<{ expired: number }> {
    return { expired: await this.assignments.expireStale(new Date()) };
  }
}
