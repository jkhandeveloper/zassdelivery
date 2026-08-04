import type {
  DeliveryAssignment,
  Driver,
  DriverAvailability,
  DriverDocument,
  DriverDocumentStatus,
  DriverDocumentType,
  DriverStatus,
  Prisma,
  User,
  Vehicle,
  VehicleType,
} from '@prisma/client';

import type { PaginatedResult } from '@/common/interfaces/paginated-result.interface';

/** A rider loaded with everything the profile and approval screens need. */
export type RiderWithDetails = Driver & {
  user: Pick<User, 'id' | 'fullName' | 'phone' | 'email' | 'avatarUrl' | 'status'>;
  zone: { id: string; name: string } | null;
  vehicles: Vehicle[];
  documents: DriverDocument[];
};

export interface ListRidersFilter {
  page: number;
  limit: number;
  orderBy: Prisma.DriverOrderByWithRelationInput;
  status?: DriverStatus;
  availability?: DriverAvailability;
  zoneId?: string;
  /** Matches the rider's name, phone or CNIC. */
  search?: string;
}

export interface RegisterRiderInput {
  userId: string;
  cnic: string;
  licenseNumber: string | null;
  zoneId: string | null;
  vehicle: {
    type: VehicleType;
    make: string | null;
    model: string | null;
    year: number | null;
    color: string | null;
    plateNumber: string | null;
  };
  payout: {
    bankName: string | null;
    accountTitle: string | null;
    accountNumber: string | null;
  };
}

export interface UpdateRiderInput {
  licenseNumber?: string | null;
  zoneId?: string | null;
  payoutBankName?: string | null;
  payoutAccountTitle?: string | null;
  payoutAccountNumber?: string | null;
}

export interface SetRiderStatusInput {
  status: DriverStatus;
  reviewerId: string;
  rejectionReason?: string | null;
  /** Set on approval; cleared when an application returns to the queue. */
  verified?: boolean;
}

export interface UpsertDocumentInput {
  driverId: string;
  type: DriverDocumentType;
  fileUrl: string;
  number: string | null;
  expiresAt: Date | null;
}

export abstract class RiderRepository {
  abstract findMany(filter: ListRidersFilter): Promise<PaginatedResult<RiderWithDetails>>;
  abstract findById(id: string): Promise<RiderWithDetails | null>;
  abstract findByUserId(userId: string): Promise<RiderWithDetails | null>;
  abstract existsByCnic(cnic: string): Promise<boolean>;

  /**
   * Creates the rider profile and its first vehicle together, and opens a
   * wallet for the earnings that will follow. A rider with a profile but no
   * wallet would fail on their first completed delivery, which is the worst
   * possible moment to discover it.
   */
  abstract register(input: RegisterRiderInput): Promise<RiderWithDetails>;

  abstract update(id: string, input: UpdateRiderInput): Promise<RiderWithDetails>;
  abstract setStatus(id: string, input: SetRiderStatusInput): Promise<RiderWithDetails>;

  /**
   * Moves a rider between OFFLINE, ONLINE and ON_BREAK, optionally recording
   * the position they reported with the change.
   */
  abstract setAvailability(
    id: string,
    availability: DriverAvailability,
    location?: { latitude: number; longitude: number } | null,
  ): Promise<RiderWithDetails>;

  abstract updateLocation(id: string, latitude: number, longitude: number): Promise<void>;

  // ── Documents ────────────────────────────────────────────────

  abstract listDocuments(driverId: string): Promise<DriverDocument[]>;

  /**
   * Files a document, replacing any previous upload of the same type. The
   * replacement always returns to PENDING: a rejected document must not be
   * quietly resurrected as verified by re-uploading the same file.
   */
  abstract upsertDocument(input: UpsertDocumentInput): Promise<DriverDocument>;

  abstract reviewDocument(
    documentId: string,
    input: {
      status: DriverDocumentStatus;
      reviewerId: string;
      rejectionReason?: string | null;
    },
  ): Promise<DriverDocument>;

  abstract findDocument(
    documentId: string,
  ): Promise<(DriverDocument & { driverId: string }) | null>;

  // ── Dispatch support ─────────────────────────────────────────

  /**
   * Riders who are approved, online and not already carrying an order.
   *
   * Not filtered by zone: the order's zone is a *preference* applied when
   * ranking, so a rider standing outside the boundary but two streets from the
   * restaurant still wins over one across town in the right zone.
   */
  abstract findDispatchCandidates(orderId: string): Promise<
    Array<{
      driverId: string;
      zoneId: string | null;
      currentLat: number | null;
      currentLng: number | null;
      lastLocationAt: Date | null;
      rating: number;
      hasRejectedThisOrder: boolean;
    }>
  >;

  /** The delivery a rider is currently carrying, if any. */
  abstract findActiveAssignment(driverId: string): Promise<DeliveryAssignment | null>;

  abstract countDeliveries(driverId: string): Promise<number>;
}
