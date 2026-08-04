import { Injectable } from '@nestjs/common';
import { DriverAvailability, DriverDocumentStatus, DriverStatus } from '@prisma/client';

import {
  BusinessRuleViolationException,
  ResourceNotFoundException,
} from '@/common/exceptions/domain.exception';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import type { PaginatedResult } from '@/common/interfaces/paginated-result.interface';
import { buildOrderBy } from '@/common/utils/pagination.util';

import { RiderRepository } from '../../domain/repositories/rider.repository';
import { RiderLifecycle } from '../../domain/services/rider-lifecycle';
import {
  toDocumentDto,
  toRiderDto,
  type RiderDocumentDto,
  type RiderDto,
} from '../dto/rider-response.dto';
import {
  RIDER_SORT_FIELDS,
  type ListRidersQueryDto,
  type RejectDocumentDto,
  type RejectRiderDto,
  type SuspendRiderDto,
} from '../dto/rider.dto';
import {
  RiderAccessService,
  requiresVehicleDocuments,
  verifiedDocumentTypes,
} from './rider-profile.use-cases';

@Injectable()
export class ListRidersUseCase {
  constructor(private readonly riders: RiderRepository) {}

  async execute(query: ListRidersQueryDto): Promise<PaginatedResult<RiderDto>> {
    const orderBy = buildOrderBy(query.sortBy, query.sortOrder, RIDER_SORT_FIELDS, 'createdAt');

    const result = await this.riders.findMany({
      page: query.page,
      limit: query.limit,
      orderBy,
      status: query.status,
      availability: query.availability,
      zoneId: query.zoneId,
      search: query.search,
    });

    return {
      items: result.items.map((rider) => toRiderDto(rider, { includePayout: true })),
      meta: result.meta,
    };
  }
}

@Injectable()
export class GetRiderUseCase {
  constructor(private readonly access: RiderAccessService) {}

  async execute(id: string): Promise<RiderDto> {
    return toRiderDto(await this.access.byId(id), { includePayout: true });
  }
}

@Injectable()
export class ApproveRiderUseCase {
  constructor(
    private readonly riders: RiderRepository,
    private readonly access: RiderAccessService,
  ) {}

  /**
   * Puts an approved rider on the road.
   *
   * Blocked until every required document is verified and current. Approving
   * around a missing CNIC would put an unidentified person on a customer's
   * doorstep with their food and their cash, which is the one failure this
   * whole workflow exists to prevent.
   */
  async execute(id: string, reviewer: AuthenticatedUser): Promise<RiderDto> {
    const rider = await this.access.byId(id);

    RiderLifecycle.assertTransition(rider.status, DriverStatus.ACTIVE);

    const missing = RiderLifecycle.missingDocuments(verifiedDocumentTypes(rider), {
      requiresVehicleDocuments: requiresVehicleDocuments(rider),
    });

    if (missing.length > 0) {
      throw new BusinessRuleViolationException(
        `These documents must be verified before approval: ${missing.join(', ')}.`,
      );
    }

    const updated = await this.riders.setStatus(id, {
      status: DriverStatus.ACTIVE,
      reviewerId: reviewer.id,
      rejectionReason: null,
      verified: true,
    });

    return toRiderDto(updated, { includePayout: true });
  }
}

@Injectable()
export class RejectRiderUseCase {
  constructor(
    private readonly riders: RiderRepository,
    private readonly access: RiderAccessService,
  ) {}

  async execute(id: string, dto: RejectRiderDto, reviewer: AuthenticatedUser): Promise<RiderDto> {
    const rider = await this.access.byId(id);

    RiderLifecycle.assertTransition(rider.status, DriverStatus.REJECTED);

    const updated = await this.riders.setStatus(id, {
      status: DriverStatus.REJECTED,
      reviewerId: reviewer.id,
      rejectionReason: dto.reason,
    });

    return toRiderDto(updated, { includePayout: true });
  }
}

@Injectable()
export class SuspendRiderUseCase {
  constructor(
    private readonly riders: RiderRepository,
    private readonly access: RiderAccessService,
  ) {}

  /**
   * Takes a rider off the road immediately.
   *
   * Refused while they are carrying an order: suspending mid-delivery would
   * strand food that a customer has already paid for. The delivery is finished
   * or handed back first, then the suspension lands.
   */
  async execute(id: string, dto: SuspendRiderDto, reviewer: AuthenticatedUser): Promise<RiderDto> {
    const rider = await this.access.byId(id);

    RiderLifecycle.assertTransition(rider.status, DriverStatus.SUSPENDED);

    if (rider.availability === DriverAvailability.ON_DELIVERY) {
      throw new BusinessRuleViolationException(
        'This rider is mid-delivery. Reassign the order before suspending them.',
      );
    }

    const updated = await this.riders.setStatus(id, {
      status: DriverStatus.SUSPENDED,
      reviewerId: reviewer.id,
      rejectionReason: dto.reason,
    });

    return toRiderDto(updated, { includePayout: true });
  }
}

@Injectable()
export class ReinstateRiderUseCase {
  constructor(
    private readonly riders: RiderRepository,
    private readonly access: RiderAccessService,
  ) {}

  /** Lifts a suspension. Documents are re-checked, since time has passed. */
  async execute(id: string, reviewer: AuthenticatedUser): Promise<RiderDto> {
    const rider = await this.access.byId(id);

    RiderLifecycle.assertTransition(rider.status, DriverStatus.ACTIVE);

    const missing = RiderLifecycle.missingDocuments(verifiedDocumentTypes(rider), {
      requiresVehicleDocuments: requiresVehicleDocuments(rider),
    });

    if (missing.length > 0) {
      throw new BusinessRuleViolationException(
        `These documents are missing or have expired since the suspension: ${missing.join(', ')}.`,
      );
    }

    const updated = await this.riders.setStatus(id, {
      status: DriverStatus.ACTIVE,
      reviewerId: reviewer.id,
      rejectionReason: null,
    });

    return toRiderDto(updated, { includePayout: true });
  }
}

@Injectable()
export class ResubmitApplicationUseCase {
  constructor(
    private readonly riders: RiderRepository,
    private readonly access: RiderAccessService,
  ) {}

  /**
   * Puts a rejected application back in the queue once the rider has fixed
   * what was wrong. A rejected application never goes live without a second
   * review.
   */
  async execute(actor: AuthenticatedUser): Promise<RiderDto> {
    const rider = await this.access.mine(actor);

    RiderLifecycle.assertTransition(rider.status, DriverStatus.PENDING_APPROVAL);

    const updated = await this.riders.setStatus(rider.id, {
      status: DriverStatus.PENDING_APPROVAL,
      reviewerId: actor.id,
      rejectionReason: null,
    });

    return toRiderDto(updated, { includePayout: true });
  }
}

@Injectable()
export class ListRiderDocumentsUseCase {
  constructor(
    private readonly riders: RiderRepository,
    private readonly access: RiderAccessService,
  ) {}

  async execute(riderId: string): Promise<RiderDocumentDto[]> {
    await this.access.byId(riderId);
    const documents = await this.riders.listDocuments(riderId);

    return documents.map((document) => toDocumentDto(document));
  }
}

@Injectable()
export class ReviewDocumentUseCase {
  constructor(private readonly riders: RiderRepository) {}

  /**
   * Verifies or rejects a single uploaded document.
   *
   * Reviewed one at a time rather than as a batch: a reviewer who can only
   * approve the whole set at once ends up approving documents they did not
   * actually look at.
   */
  async verify(documentId: string, reviewer: AuthenticatedUser): Promise<RiderDocumentDto> {
    const document = await this.load(documentId);

    if (document.expiresAt !== null && document.expiresAt <= new Date()) {
      throw new BusinessRuleViolationException(
        'This document has expired. Ask the rider to upload a current one.',
      );
    }

    const updated = await this.riders.reviewDocument(documentId, {
      status: DriverDocumentStatus.VERIFIED,
      reviewerId: reviewer.id,
      rejectionReason: null,
    });

    return toDocumentDto(updated);
  }

  async reject(
    documentId: string,
    dto: RejectDocumentDto,
    reviewer: AuthenticatedUser,
  ): Promise<RiderDocumentDto> {
    await this.load(documentId);

    const updated = await this.riders.reviewDocument(documentId, {
      status: DriverDocumentStatus.REJECTED,
      reviewerId: reviewer.id,
      rejectionReason: dto.reason,
    });

    return toDocumentDto(updated);
  }

  private async load(documentId: string) {
    const document = await this.riders.findDocument(documentId);

    if (!document) {
      throw new ResourceNotFoundException('Document', documentId);
    }

    return document;
  }
}
