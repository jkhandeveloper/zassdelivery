import { DriverAvailability, DriverDocumentType, DriverStatus } from '@prisma/client';

import { BusinessRuleViolationException } from '@/common/exceptions/domain.exception';

/**
 * The onboarding lifecycle, declared as data.
 *
 * As with restaurants and orders, encoding the legal moves as a table rather
 * than as scattered `if` statements keeps the whole flow readable in one place
 * and makes an illegal jump — a rejected applicant going straight to ACTIVE
 * without a second review — fail loudly instead of quietly putting an
 * unverified rider on the road.
 */
export const RIDER_TRANSITIONS: Record<DriverStatus, DriverStatus[]> = {
  [DriverStatus.PENDING_APPROVAL]: [DriverStatus.ACTIVE, DriverStatus.REJECTED],
  [DriverStatus.ACTIVE]: [DriverStatus.SUSPENDED],
  [DriverStatus.SUSPENDED]: [DriverStatus.ACTIVE, DriverStatus.REJECTED],
  // A rejected application goes back to the queue once the rider fixes what was
  // wrong with it; it never jumps straight to active.
  [DriverStatus.REJECTED]: [DriverStatus.PENDING_APPROVAL],
};

/**
 * Documents an applicant must have verified before they can be approved.
 *
 * Identity and the right to drive are the non-negotiables. Vehicle
 * registration is conditional — a rider on foot or on a bicycle has nothing to
 * register — and a profile photo is how a customer recognises who is at the
 * door, so it is required but not identity-critical.
 */
export const REQUIRED_DOCUMENTS: DriverDocumentType[] = [
  DriverDocumentType.CNIC_FRONT,
  DriverDocumentType.CNIC_BACK,
  DriverDocumentType.PROFILE_PHOTO,
];

/** Vehicle types whose paperwork must also be on file. */
export const REGISTRABLE_VEHICLE_DOCUMENTS: DriverDocumentType[] = [
  DriverDocumentType.DRIVING_LICENSE,
  DriverDocumentType.VEHICLE_REGISTRATION,
];

/** Availability values in which a rider is considered to be working. */
export const WORKING_AVAILABILITY: DriverAvailability[] = [
  DriverAvailability.ONLINE,
  DriverAvailability.ON_DELIVERY,
];

export class RiderLifecycle {
  /** Validates an approval-workflow move and explains any refusal. */
  static assertTransition(from: DriverStatus, to: DriverStatus): void {
    if (from === to) {
      throw new BusinessRuleViolationException(`This rider is already ${from}.`);
    }

    const allowed = RIDER_TRANSITIONS[from];

    if (!allowed.includes(to)) {
      throw new BusinessRuleViolationException(
        `A rider cannot move from ${from} to ${to}. Allowed: ${allowed.join(', ') || 'none'}.`,
      );
    }
  }

  /**
   * Which documents this applicant still owes, given the vehicle they ride.
   *
   * Returned rather than thrown so the rider's own profile screen can show the
   * same checklist the reviewer sees — an applicant should never have to guess
   * why their application is stuck.
   */
  static missingDocuments(
    verified: DriverDocumentType[],
    options: { requiresVehicleDocuments: boolean },
  ): DriverDocumentType[] {
    const required = options.requiresVehicleDocuments
      ? [...REQUIRED_DOCUMENTS, ...REGISTRABLE_VEHICLE_DOCUMENTS]
      : REQUIRED_DOCUMENTS;

    return required.filter((document) => !verified.includes(document));
  }

  /**
   * Whether a rider may currently be offered work.
   *
   * Approval alone is not enough: a rider who has gone offline, is on a break
   * or is already carrying an order must not be handed another.
   */
  static canReceiveOffers(status: DriverStatus, availability: DriverAvailability): boolean {
    return status === DriverStatus.ACTIVE && availability === DriverAvailability.ONLINE;
  }

  /** Rider-facing wording for an application state. */
  static describe(status: DriverStatus): string {
    const text: Record<DriverStatus, string> = {
      [DriverStatus.PENDING_APPROVAL]: 'Application under review',
      [DriverStatus.ACTIVE]: 'Approved — you can go online',
      [DriverStatus.SUSPENDED]: 'Suspended — contact support',
      [DriverStatus.REJECTED]: 'Application rejected',
    };

    return text[status];
  }
}
