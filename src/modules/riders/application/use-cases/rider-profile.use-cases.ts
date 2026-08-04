import { Injectable } from '@nestjs/common';
import {
  DriverAvailability,
  DriverDocumentStatus,
  DriverStatus,
  UserRole,
  VehicleType,
  type DriverDocumentType,
} from '@prisma/client';

import {
  BusinessRuleViolationException,
  ForbiddenOperationException,
  ResourceConflictException,
  ResourceNotFoundException,
} from '@/common/exceptions/domain.exception';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';

import { RiderRepository, type RiderWithDetails } from '../../domain/repositories/rider.repository';
import {
  toDocumentDto,
  toRiderDto,
  type RiderDocumentDto,
  type RiderDto,
} from '../dto/rider-response.dto';
import type {
  RegisterRiderDto,
  SetAvailabilityDto,
  UpdateLocationDto,
  UpdateRiderDto,
  UploadDocumentDto,
} from '../dto/rider.dto';

/** Vehicles with no paperwork of their own. */
export const UNREGISTERED_VEHICLES: VehicleType[] = [VehicleType.ON_FOOT, VehicleType.BICYCLE];

/**
 * Resolves the rider profile behind a request.
 *
 * Every self-service route needs the same two answers — which rider is this,
 * and are they allowed to be doing this at all — so both live here rather than
 * being re-derived, slightly differently, in each use-case.
 */
@Injectable()
export class RiderAccessService {
  constructor(private readonly riders: RiderRepository) {}

  /** The caller's own rider profile. */
  async mine(actor: AuthenticatedUser): Promise<RiderWithDetails> {
    const rider = await this.riders.findByUserId(actor.id);

    if (!rider) {
      throw new ResourceNotFoundException('Rider profile');
    }

    return rider;
  }

  /**
   * The caller's profile, refused unless they are approved.
   *
   * Applied to everything operational — going online, answering offers,
   * delivering — so a suspended rider is stopped at the door rather than
   * halfway through a delivery.
   */
  async approved(actor: AuthenticatedUser): Promise<RiderWithDetails> {
    const rider = await this.mine(actor);

    if (rider.status !== DriverStatus.ACTIVE) {
      throw new ForbiddenOperationException(
        rider.status === DriverStatus.PENDING_APPROVAL
          ? 'Your application is still under review.'
          : `Your rider account is ${rider.status.toLowerCase()}. ${rider.rejectionReason ?? ''}`.trim(),
      );
    }

    return rider;
  }

  /** Loads any rider by id, for staff screens. */
  async byId(id: string): Promise<RiderWithDetails> {
    const rider = await this.riders.findById(id);

    if (!rider) {
      throw new ResourceNotFoundException('Rider', id);
    }

    return rider;
  }

  /** Whether the caller may see another rider's private fields. */
  static isStaff(actor: AuthenticatedUser): boolean {
    return actor.role === UserRole.ADMIN || actor.role === UserRole.SUPER_ADMIN;
  }
}

@Injectable()
export class RegisterRiderUseCase {
  constructor(private readonly riders: RiderRepository) {}

  /**
   * Creates the rider profile in PENDING_APPROVAL.
   *
   * Nothing here puts a rider on the road: the application still has to clear
   * document review. Registration only opens the file.
   */
  async execute(actor: AuthenticatedUser, dto: RegisterRiderDto): Promise<RiderDto> {
    const existing = await this.riders.findByUserId(actor.id);

    if (existing) {
      throw new ResourceConflictException(
        'You already have a rider profile. Update it instead of registering again.',
      );
    }

    // The CNIC is the identity a rider is approved against, so one CNIC is one
    // rider. Without this a suspended rider could re-apply under a new account.
    if (await this.riders.existsByCnic(dto.cnic)) {
      throw new ResourceConflictException(
        'A rider is already registered with this CNIC. Contact support if this is you.',
      );
    }

    const requiresPlate = !UNREGISTERED_VEHICLES.includes(dto.vehicle.type);

    if (requiresPlate && !dto.vehicle.plateNumber) {
      throw new BusinessRuleViolationException(
        `A ${dto.vehicle.type.toLowerCase().replace('_', ' ')} must be registered with its plate number.`,
      );
    }

    const rider = await this.riders.register({
      userId: actor.id,
      cnic: dto.cnic,
      licenseNumber: dto.licenseNumber ?? null,
      zoneId: dto.zoneId ?? null,
      vehicle: {
        type: dto.vehicle.type,
        make: dto.vehicle.make ?? null,
        model: dto.vehicle.model ?? null,
        year: dto.vehicle.year ?? null,
        color: dto.vehicle.color ?? null,
        plateNumber: requiresPlate ? (dto.vehicle.plateNumber ?? null) : null,
      },
      payout: {
        bankName: dto.payout?.bankName ?? null,
        accountTitle: dto.payout?.accountTitle ?? null,
        accountNumber: dto.payout?.accountNumber ?? null,
      },
    });

    return toRiderDto(rider, { includePayout: true });
  }
}

@Injectable()
export class GetMyRiderProfileUseCase {
  constructor(private readonly access: RiderAccessService) {}

  async execute(actor: AuthenticatedUser): Promise<RiderDto> {
    return toRiderDto(await this.access.mine(actor), { includePayout: true });
  }
}

@Injectable()
export class UpdateRiderProfileUseCase {
  constructor(
    private readonly riders: RiderRepository,
    private readonly access: RiderAccessService,
  ) {}

  /**
   * Edits the parts of a profile a rider owns.
   *
   * The CNIC is deliberately not among them: it is what the approval was made
   * against, and changing it would silently invalidate a verified identity.
   */
  async execute(actor: AuthenticatedUser, dto: UpdateRiderDto): Promise<RiderDto> {
    const rider = await this.access.mine(actor);

    const updated = await this.riders.update(rider.id, {
      ...(dto.licenseNumber !== undefined && { licenseNumber: dto.licenseNumber }),
      ...(dto.zoneId !== undefined && { zoneId: dto.zoneId }),
      ...(dto.payout?.bankName !== undefined && { payoutBankName: dto.payout.bankName }),
      ...(dto.payout?.accountTitle !== undefined && {
        payoutAccountTitle: dto.payout.accountTitle,
      }),
      ...(dto.payout?.accountNumber !== undefined && {
        payoutAccountNumber: dto.payout.accountNumber,
      }),
    });

    return toRiderDto(updated, { includePayout: true });
  }
}

@Injectable()
export class ListMyDocumentsUseCase {
  constructor(
    private readonly riders: RiderRepository,
    private readonly access: RiderAccessService,
  ) {}

  async execute(actor: AuthenticatedUser): Promise<RiderDocumentDto[]> {
    const rider = await this.access.mine(actor);
    const documents = await this.riders.listDocuments(rider.id);

    return documents.map((document) => toDocumentDto(document));
  }
}

@Injectable()
export class UploadDocumentUseCase {
  constructor(
    private readonly riders: RiderRepository,
    private readonly access: RiderAccessService,
  ) {}

  /**
   * Files a document for review, replacing any previous upload of the same
   * type. The replacement always returns to PENDING — a rejected document
   * cannot be quietly resurrected by uploading the same file again.
   */
  async execute(actor: AuthenticatedUser, dto: UploadDocumentDto): Promise<RiderDocumentDto> {
    const rider = await this.access.mine(actor);

    if (dto.expiresAt && dto.expiresAt <= new Date()) {
      throw new BusinessRuleViolationException(
        'This document has already expired. Upload a current one.',
      );
    }

    const document = await this.riders.upsertDocument({
      driverId: rider.id,
      type: dto.type,
      fileUrl: dto.fileUrl,
      number: dto.number ?? null,
      expiresAt: dto.expiresAt ?? null,
    });

    return toDocumentDto(document);
  }
}

@Injectable()
export class SetAvailabilityUseCase {
  constructor(
    private readonly riders: RiderRepository,
    private readonly access: RiderAccessService,
  ) {}

  /**
   * The rider's own online switch.
   *
   * Going offline mid-delivery is refused rather than silently ignored: the
   * order is already someone's dinner, and the customer is watching a rider who
   * would simply stop existing.
   */
  async execute(actor: AuthenticatedUser, dto: SetAvailabilityDto): Promise<RiderDto> {
    const rider = await this.access.approved(actor);

    if (rider.availability === DriverAvailability.ON_DELIVERY) {
      throw new BusinessRuleViolationException(
        'Finish or hand back your current delivery before changing your availability.',
      );
    }

    if (dto.availability === DriverAvailability.ONLINE) {
      this.assertReadyToWork(rider);
    }

    const hasLocation = dto.latitude !== undefined && dto.longitude !== undefined;

    const updated = await this.riders.setAvailability(
      rider.id,
      dto.availability,
      hasLocation ? { latitude: dto.latitude as number, longitude: dto.longitude as number } : null,
    );

    return toRiderDto(updated, { includePayout: true });
  }

  /**
   * A rider whose licence lapsed after approval must not keep taking work.
   * Approval is a snapshot; this is the check that keeps it honest over time.
   */
  private assertReadyToWork(rider: RiderWithDetails): void {
    const now = new Date();

    const expired = rider.documents.filter(
      (document) =>
        document.status === DriverDocumentStatus.VERIFIED &&
        document.expiresAt !== null &&
        document.expiresAt <= now,
    );

    if (expired.length > 0) {
      const names = expired.map((document) => document.type).join(', ');

      throw new BusinessRuleViolationException(
        `These documents have expired and must be re-uploaded before you can go online: ${names}.`,
      );
    }
  }
}

@Injectable()
export class UpdateLocationUseCase {
  constructor(
    private readonly riders: RiderRepository,
    private readonly access: RiderAccessService,
  ) {}

  /**
   * Records the rider's latest position.
   *
   * Deliberately a bare write with no response body: this is called every few
   * seconds by a phone on a patchy mobile connection, and anything it returns
   * is bandwidth spent on data nobody reads.
   */
  async execute(actor: AuthenticatedUser, dto: UpdateLocationDto): Promise<void> {
    const rider = await this.access.approved(actor);

    await this.riders.updateLocation(rider.id, dto.latitude, dto.longitude);
  }
}

/** Exported for the approval use-cases, which apply the same document rules. */
export function verifiedDocumentTypes(
  rider: RiderWithDetails,
  now: Date = new Date(),
): DriverDocumentType[] {
  return rider.documents
    .filter(
      (document) =>
        document.status === DriverDocumentStatus.VERIFIED &&
        (document.expiresAt === null || document.expiresAt > now),
    )
    .map((document) => document.type);
}

export function requiresVehicleDocuments(rider: RiderWithDetails): boolean {
  return rider.vehicles.some(
    (vehicle) => vehicle.isActive && !UNREGISTERED_VEHICLES.includes(vehicle.type),
  );
}
