import type {
  AssignmentStatus,
  DeliveryAssignment,
  Order,
  Prisma,
  Restaurant,
  User,
} from '@prisma/client';

import type { PaginatedResult } from '@/common/interfaces/paginated-result.interface';

/** An assignment with the order context a rider's screen needs. */
export type AssignmentWithOrder = DeliveryAssignment & {
  order: Pick<
    Order,
    | 'id'
    | 'orderNumber'
    | 'status'
    | 'type'
    | 'totalAmount'
    | 'tipAmount'
    | 'paymentMethod'
    | 'paymentStatus'
    | 'distanceKm'
    | 'deliveryLine1'
    | 'deliveryLandmark'
    | 'deliveryLat'
    | 'deliveryLng'
    | 'deliveryNotes'
    | 'recipientName'
    | 'recipientPhone'
    | 'customerId'
    | 'estimatedDeliveryAt'
  > & {
    restaurant: Pick<
      Restaurant,
      'id' | 'name' | 'phone' | 'addressLine' | 'latitude' | 'longitude'
    >;
    customer: Pick<User, 'fullName' | 'phone'>;
  };
};

export interface ListAssignmentsFilter {
  page: number;
  limit: number;
  orderBy: Prisma.DeliveryAssignmentOrderByWithRelationInput;
  driverId?: string;
  orderId?: string;
  status?: AssignmentStatus;
  /** Offers still open and unanswered — the rider's inbox. */
  liveOnly?: boolean;
  from?: Date;
  to?: Date;
}

export interface CreateAssignmentInput {
  orderId: string;
  driverId: string;
  expiresAt: Date;
  pickupDistanceKm: number | null;
  estimatedEarning: number;
  assignedById: string | null;
  isAuto: boolean;
}

export abstract class AssignmentRepository {
  abstract findMany(filter: ListAssignmentsFilter): Promise<PaginatedResult<AssignmentWithOrder>>;
  abstract findById(id: string): Promise<AssignmentWithOrder | null>;

  /** The rider's live assignment for an order, whether offered or accepted. */
  abstract findForOrderAndDriver(
    orderId: string,
    driverId: string,
  ): Promise<AssignmentWithOrder | null>;

  /**
   * Creates an offer.
   *
   * Fails loudly when the order already has a live assignment or the rider is
   * already carrying one — the partial unique indexes behind this are what stop
   * two dispatchers double-assigning the same order under a race.
   */
  abstract offer(input: CreateAssignmentInput): Promise<AssignmentWithOrder>;

  /**
   * Accepts an offer: the assignment becomes ACCEPTED, the order gains its
   * rider and the rider moves to ON_DELIVERY, all in one transaction.
   */
  abstract accept(assignmentId: string): Promise<AssignmentWithOrder>;

  abstract reject(assignmentId: string, reason: string | null): Promise<AssignmentWithOrder>;

  /** Withdraws an offer or an acceptance, freeing the order for re-dispatch. */
  abstract cancel(assignmentId: string, reason: string): Promise<AssignmentWithOrder>;

  /** Marks unanswered offers past their deadline as EXPIRED. Returns the count. */
  abstract expireStale(now: Date): Promise<number>;

  // ── Delivery confirmation ────────────────────────────────────

  abstract storeOtp(assignmentId: string, hash: string, issuedAt: Date): Promise<void>;
  abstract recordOtpFailure(assignmentId: string): Promise<void>;

  /**
   * Closes out a delivery: the code is marked verified and the assignment
   * COMPLETED. Called only after the order itself has moved to DELIVERED.
   */
  abstract complete(assignmentId: string): Promise<void>;
}
