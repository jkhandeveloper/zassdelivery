import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  AssignmentStatus,
  DriverAvailability,
  DriverDocumentStatus,
  DriverDocumentType,
  DriverEarningType,
  DriverStatus,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  PayoutMethod,
  PayoutStatus,
  VehicleType,
  type DriverEarning,
  type DriverDocument,
  type PayoutRequest,
  type WalletTransaction,
} from '@prisma/client';

import type { AssignmentWithOrder } from '../../domain/repositories/assignment.repository';
import type { RiderWithDetails } from '../../domain/repositories/rider.repository';
import { RiderLifecycle } from '../../domain/services/rider-lifecycle';

export class RiderVehicleResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: VehicleType }) type!: VehicleType;
  @ApiPropertyOptional({ nullable: true, example: 'Honda' }) make!: string | null;
  @ApiPropertyOptional({ nullable: true, example: 'CD 70' }) model!: string | null;
  @ApiPropertyOptional({ nullable: true, example: 2021 }) year!: number | null;
  @ApiPropertyOptional({ nullable: true, example: 'Red' }) color!: string | null;
  @ApiPropertyOptional({ nullable: true, example: 'PES-1234' }) plateNumber!: string | null;
  @ApiProperty({ example: true }) isPrimary!: boolean;
  @ApiProperty({ example: true }) isActive!: boolean;
}

export class RiderDocumentDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: DriverDocumentType }) type!: DriverDocumentType;
  @ApiProperty({ enum: DriverDocumentStatus }) status!: DriverDocumentStatus;
  @ApiProperty({ example: 'https://cdn.zassdelivery.pk/riders/cnic-front.jpg' })
  fileUrl!: string;
  @ApiPropertyOptional({ nullable: true }) number!: string | null;
  @ApiPropertyOptional({ nullable: true }) expiresAt!: Date | null;
  @ApiProperty({ example: false, description: 'True once the expiry date has passed.' })
  isExpired!: boolean;
  @ApiPropertyOptional({ nullable: true }) rejectionReason!: string | null;
  @ApiPropertyOptional({ nullable: true }) reviewedAt!: Date | null;
  @ApiProperty() createdAt!: Date;
}

export class RiderPayoutDetailsDto {
  @ApiPropertyOptional({ nullable: true, example: 'Meezan Bank' }) bankName!: string | null;
  @ApiPropertyOptional({ nullable: true, example: 'Ahmad Khan' }) accountTitle!: string | null;
  @ApiPropertyOptional({
    nullable: true,
    example: '••••4567',
    description: 'Masked: only the last four digits are ever returned.',
  })
  accountNumber!: string | null;
}

export class RiderDto {
  @ApiProperty() id!: string;
  @ApiProperty() userId!: string;
  @ApiProperty({ example: 'Bilal Ahmed' }) fullName!: string;
  @ApiProperty({ example: '+923005551234' }) phone!: string;
  @ApiPropertyOptional({ nullable: true }) email!: string | null;
  @ApiPropertyOptional({ nullable: true }) avatarUrl!: string | null;

  @ApiProperty({
    example: '••••••••5678',
    description: 'Masked: the CNIC is never returned in full once stored.',
  })
  cnic!: string;
  @ApiPropertyOptional({ nullable: true }) licenseNumber!: string | null;

  @ApiProperty({ enum: DriverStatus }) status!: DriverStatus;
  @ApiProperty({ example: 'Application under review' }) statusText!: string;
  @ApiProperty({ enum: DriverAvailability }) availability!: DriverAvailability;
  @ApiPropertyOptional({ nullable: true }) rejectionReason!: string | null;

  @ApiPropertyOptional({ nullable: true }) zoneId!: string | null;
  @ApiPropertyOptional({ nullable: true, example: 'Pabbi Central' }) zoneName!: string | null;

  @ApiPropertyOptional({ nullable: true, example: 34.0151 }) currentLat!: number | null;
  @ApiPropertyOptional({ nullable: true, example: 71.7938 }) currentLng!: number | null;
  @ApiPropertyOptional({ nullable: true }) lastLocationAt!: Date | null;
  @ApiPropertyOptional({ nullable: true }) onlineSince!: Date | null;

  @ApiProperty({ example: 4.8 }) rating!: number;
  @ApiProperty({ example: 132 }) ratingCount!: number;
  @ApiProperty({ example: 486 }) totalDeliveries!: number;

  @ApiProperty({ type: [RiderVehicleResponseDto] }) vehicles!: RiderVehicleResponseDto[];
  @ApiProperty({ type: [RiderDocumentDto] }) documents!: RiderDocumentDto[];

  @ApiProperty({
    type: [String],
    enum: DriverDocumentType,
    description: 'Verified documents still outstanding before this rider can be approved.',
  })
  missingDocuments!: DriverDocumentType[];

  @ApiProperty({ example: false, description: 'Whether the rider may go online right now.' })
  canGoOnline!: boolean;

  @ApiPropertyOptional({ type: RiderPayoutDetailsDto })
  payout?: RiderPayoutDetailsDto;

  @ApiPropertyOptional({ nullable: true }) verifiedAt!: Date | null;
  @ApiProperty() createdAt!: Date;
}

export class AssignmentOrderDto {
  @ApiProperty() id!: string;
  @ApiProperty({ example: 'ZD-260809-0007' }) orderNumber!: string;
  @ApiProperty({ enum: OrderStatus }) status!: OrderStatus;
  @ApiProperty({ example: 1240 }) totalAmount!: number;
  @ApiProperty({ enum: PaymentMethod }) paymentMethod!: PaymentMethod;
  @ApiProperty({ enum: PaymentStatus }) paymentStatus!: PaymentStatus;
  @ApiProperty({
    example: 1240,
    description: 'Cash the rider must collect at the door. Zero for prepaid orders.',
  })
  cashToCollect!: number;

  @ApiProperty({ example: 'Chapli Kabab House' }) restaurantName!: string;
  @ApiProperty({ example: 'Main GT Road, Pabbi' }) restaurantAddress!: string;
  @ApiPropertyOptional({ nullable: true }) restaurantPhone!: string | null;
  @ApiPropertyOptional({ nullable: true, example: 34.0151 }) restaurantLat!: number | null;
  @ApiPropertyOptional({ nullable: true, example: 71.7938 }) restaurantLng!: number | null;

  @ApiProperty({ example: 'House 14, Street 3, Gulshan Colony' }) deliveryAddress!: string;
  @ApiPropertyOptional({ nullable: true }) deliveryLandmark!: string | null;
  @ApiPropertyOptional({ nullable: true }) deliveryNotes!: string | null;
  @ApiPropertyOptional({ nullable: true, example: 34.0182 }) deliveryLat!: number | null;
  @ApiPropertyOptional({ nullable: true, example: 71.8011 }) deliveryLng!: number | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Withheld until the rider accepts the run.',
  })
  customerName!: string | null;
  @ApiPropertyOptional({ nullable: true, description: 'Withheld until the rider accepts the run.' })
  customerPhone!: string | null;

  @ApiPropertyOptional({ nullable: true, example: 2.4 }) distanceKm!: number | null;
  @ApiPropertyOptional({ nullable: true }) estimatedDeliveryAt!: Date | null;
}

export class AssignmentDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: AssignmentStatus }) status!: AssignmentStatus;
  @ApiProperty({ example: true, description: 'Still open and answerable.' }) isLive!: boolean;

  @ApiProperty({ type: AssignmentOrderDto }) order!: AssignmentOrderDto;

  @ApiPropertyOptional({ nullable: true, example: 1.2 }) pickupDistanceKm!: number | null;
  @ApiProperty({ example: 105, description: 'Quoted before the tip, which may still change.' })
  estimatedEarning!: number;

  @ApiProperty({ example: true, description: 'False when a dispatcher assigned it by hand.' })
  isAuto!: boolean;

  @ApiProperty() offeredAt!: Date;
  @ApiProperty() expiresAt!: Date;
  @ApiPropertyOptional({ nullable: true }) respondedAt!: Date | null;
  @ApiPropertyOptional({ nullable: true }) completedAt!: Date | null;
  @ApiPropertyOptional({ nullable: true }) rejectionReason!: string | null;

  @ApiProperty({
    example: false,
    description: 'Whether a delivery code has been issued and is awaiting confirmation.',
  })
  awaitingDeliveryCode!: boolean;
}

export class EarningDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: DriverEarningType }) type!: DriverEarningType;
  @ApiProperty({ example: 60 }) amount!: number;
  @ApiPropertyOptional({ nullable: true, example: 'Base fare' }) description!: string | null;
  @ApiPropertyOptional({ nullable: true }) orderId!: string | null;
  @ApiPropertyOptional({ nullable: true, example: 'ZD-260809-0007' }) orderNumber!: string | null;
  @ApiProperty() earnedAt!: Date;
}

export class EarningsSummaryDto {
  @ApiProperty({ example: 1450 }) today!: number;
  @ApiProperty({ example: 8600 }) thisWeek!: number;
  @ApiProperty({ example: 31200 }) thisMonth!: number;
  @ApiProperty({ example: 214300 }) lifetime!: number;
  @ApiProperty({ example: 11 }) deliveriesToday!: number;
  @ApiProperty({ example: 64 }) deliveriesThisWeek!: number;
  @ApiProperty({ example: 486 }) deliveriesLifetime!: number;
  @ApiProperty({ example: 131.8, description: 'Lifetime earnings divided by deliveries.' })
  averagePerDelivery!: number;
}

export class RiderWalletDto {
  @ApiProperty({ example: 4820.5 }) balance!: number;
  @ApiProperty({ example: 'PKR' }) currency!: string;
  @ApiProperty({ example: false, description: 'Frozen during a fraud investigation.' })
  isLocked!: boolean;
  @ApiProperty({ example: 2500, description: 'Already committed to withdrawals in progress.' })
  pendingWithdrawals!: number;
  @ApiProperty({ example: 2320.5, description: 'Balance minus what is held for withdrawals.' })
  availableToWithdraw!: number;
}

export class WalletTransactionDto {
  @ApiProperty() id!: string;
  @ApiProperty({ example: 'CREDIT' }) type!: string;
  @ApiProperty({ example: 'DRIVER_EARNING' }) reason!: string;
  @ApiProperty({ example: 145 }) amount!: number;
  @ApiProperty({ example: 4820.5 }) balanceAfter!: number;
  @ApiPropertyOptional({ nullable: true }) description!: string | null;
  @ApiProperty() createdAt!: Date;
}

export class PayoutRequestDto {
  @ApiProperty() id!: string;
  @ApiProperty({ example: 'WDR-260809-0001' }) reference!: string;
  @ApiProperty() driverId!: string;
  @ApiProperty({ example: 2500 }) amount!: number;
  @ApiProperty({ enum: PayoutMethod }) method!: PayoutMethod;
  @ApiProperty({ enum: PayoutStatus }) status!: PayoutStatus;
  @ApiPropertyOptional({ nullable: true, example: 'Meezan Bank' }) bankName!: string | null;
  @ApiProperty({ example: 'Ahmad Khan' }) accountTitle!: string;
  @ApiProperty({ example: '••••4567', description: 'Masked to the last four digits.' })
  accountNumber!: string;
  @ApiPropertyOptional({ nullable: true }) rejectionReason!: string | null;
  @ApiPropertyOptional({ nullable: true }) paymentReference!: string | null;
  @ApiPropertyOptional({ nullable: true }) processedAt!: Date | null;
  @ApiProperty() createdAt!: Date;
}

export class DeliveryCodeIssuedDto {
  @ApiProperty({ example: 'Order collected. Ask the customer for their four-digit code.' })
  message!: string;
  @ApiProperty({ example: true, description: 'The code has been sent to the customer.' })
  codeSent!: boolean;
  @ApiProperty({ example: 4 }) codeLength!: number;
}

export class DeliveryCompletedDto {
  @ApiProperty({ example: 'Delivery confirmed. Rs. 145 has been added to your wallet.' })
  message!: string;
  @ApiProperty({ example: 145 }) earned!: number;
  @ApiProperty({ type: [EarningDto] }) breakdown!: EarningDto[];
}

// ── Mappers ────────────────────────────────────────────────────

/**
 * Masks an identifier down to its last four characters.
 *
 * CNICs and account numbers are enough on their own to impersonate someone at
 * a bank counter, and no screen in the product needs the whole thing back — a
 * rider recognises their own account by its tail, and a reviewer works from the
 * uploaded document, not this field.
 */
function mask(value: string | null, visible = 4): string | null {
  if (value === null || value === '') {
    return null;
  }

  return value.length <= visible
    ? '•'.repeat(value.length)
    : '•'.repeat(value.length - visible) + value.slice(-visible);
}

export function toDocumentDto(document: DriverDocument, now: Date = new Date()): RiderDocumentDto {
  return {
    id: document.id,
    type: document.type,
    status: document.status,
    fileUrl: document.fileUrl,
    number: document.number,
    expiresAt: document.expiresAt,
    isExpired: document.expiresAt !== null && document.expiresAt < now,
    rejectionReason: document.rejectionReason,
    reviewedAt: document.reviewedAt,
    createdAt: document.createdAt,
  };
}

export interface RiderDtoOptions {
  /** Payout details are the rider's own business and staff's; nobody else's. */
  includePayout?: boolean;
  now?: Date;
}

export function toRiderDto(rider: RiderWithDetails, options: RiderDtoOptions = {}): RiderDto {
  const now = options.now ?? new Date();

  // A document that has lapsed no longer counts as verified, however it is
  // stored: an expired licence is not a licence.
  const verified = rider.documents
    .filter(
      (document) =>
        document.status === DriverDocumentStatus.VERIFIED &&
        (document.expiresAt === null || document.expiresAt > now),
    )
    .map((document) => document.type);

  const requiresVehicleDocuments = rider.vehicles.some(
    (vehicle) =>
      vehicle.isActive &&
      vehicle.type !== VehicleType.ON_FOOT &&
      vehicle.type !== VehicleType.BICYCLE,
  );

  const missingDocuments = RiderLifecycle.missingDocuments(verified, { requiresVehicleDocuments });

  return {
    id: rider.id,
    userId: rider.userId,
    fullName: rider.user.fullName,
    phone: rider.user.phone,
    email: rider.user.email,
    avatarUrl: rider.user.avatarUrl,
    cnic: mask(rider.cnic) ?? '',
    licenseNumber: rider.licenseNumber,
    status: rider.status,
    statusText: RiderLifecycle.describe(rider.status),
    availability: rider.availability,
    rejectionReason: rider.rejectionReason,
    zoneId: rider.zoneId,
    zoneName: rider.zone?.name ?? null,
    currentLat: rider.currentLat,
    currentLng: rider.currentLng,
    lastLocationAt: rider.lastLocationAt,
    onlineSince: rider.onlineSince,
    rating: Number(rider.rating),
    ratingCount: rider.ratingCount,
    totalDeliveries: rider.totalDeliveries,
    vehicles: rider.vehicles.map((vehicle) => ({
      id: vehicle.id,
      type: vehicle.type,
      make: vehicle.make,
      model: vehicle.model,
      year: vehicle.year,
      color: vehicle.color,
      plateNumber: vehicle.plateNumber,
      isPrimary: vehicle.isPrimary,
      isActive: vehicle.isActive,
    })),
    documents: rider.documents.map((document) => toDocumentDto(document, now)),
    missingDocuments,
    canGoOnline: rider.status === DriverStatus.ACTIVE,
    ...(options.includePayout === true && {
      payout: {
        bankName: rider.payoutBankName,
        accountTitle: rider.payoutAccountTitle,
        accountNumber: mask(rider.payoutAccountNumber),
      },
    }),
    verifiedAt: rider.verifiedAt,
    createdAt: rider.createdAt,
  };
}

/** Statuses in which the rider has committed to the run and needs the address. */
const COMMITTED_STATUSES: AssignmentStatus[] = [
  AssignmentStatus.ACCEPTED,
  AssignmentStatus.COMPLETED,
];

export interface AssignmentDtoOptions {
  /**
   * Customer contact details are only released once the rider has taken the
   * run. An offer is broadcast to whoever is nearby, and a rider who declines
   * has no business keeping the customer's phone number.
   */
  revealCustomer?: boolean;
  now?: Date;
}

export function toAssignmentDto(
  assignment: AssignmentWithOrder,
  options: AssignmentDtoOptions = {},
): AssignmentDto {
  const now = options.now ?? new Date();
  const reveal = options.revealCustomer ?? COMMITTED_STATUSES.includes(assignment.status);

  const { order } = assignment;

  return {
    id: assignment.id,
    status: assignment.status,
    isLive: assignment.status === AssignmentStatus.OFFERED && assignment.expiresAt > now,
    order: {
      id: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      totalAmount: Number(order.totalAmount),
      paymentMethod: order.paymentMethod,
      paymentStatus: order.paymentStatus,
      // Only an unpaid cash order leaves the rider holding money. Showing a
      // figure for a prepaid order is how riders end up asking for it twice.
      cashToCollect:
        order.paymentMethod === PaymentMethod.CASH_ON_DELIVERY &&
        order.paymentStatus !== PaymentStatus.PAID
          ? Number(order.totalAmount)
          : 0,
      restaurantName: order.restaurant.name,
      restaurantAddress: order.restaurant.addressLine,
      restaurantPhone: order.restaurant.phone,
      restaurantLat: order.restaurant.latitude,
      restaurantLng: order.restaurant.longitude,
      deliveryAddress: order.deliveryLine1 ?? '',
      deliveryLandmark: order.deliveryLandmark,
      deliveryNotes: order.deliveryNotes,
      deliveryLat: order.deliveryLat,
      deliveryLng: order.deliveryLng,
      customerName: reveal ? (order.recipientName ?? order.customer.fullName) : null,
      customerPhone: reveal ? (order.recipientPhone ?? order.customer.phone) : null,
      distanceKm: order.distanceKm === null ? null : Number(order.distanceKm),
      estimatedDeliveryAt: order.estimatedDeliveryAt,
    },
    pickupDistanceKm:
      assignment.pickupDistanceKm === null ? null : Number(assignment.pickupDistanceKm),
    estimatedEarning: Number(assignment.estimatedEarning),
    isAuto: assignment.isAuto,
    offeredAt: assignment.offeredAt,
    expiresAt: assignment.expiresAt,
    respondedAt: assignment.respondedAt,
    completedAt: assignment.completedAt,
    rejectionReason: assignment.rejectionReason,
    awaitingDeliveryCode: assignment.otpHash !== null && assignment.otpVerifiedAt === null,
  };
}

export function toEarningDto(
  earning: DriverEarning & { order: { id: string; orderNumber: string } | null },
): EarningDto {
  return {
    id: earning.id,
    type: earning.type,
    amount: Number(earning.amount),
    description: earning.description,
    orderId: earning.orderId,
    orderNumber: earning.order?.orderNumber ?? null,
    earnedAt: earning.earnedAt,
  };
}

export function toWalletTransactionDto(entry: WalletTransaction): WalletTransactionDto {
  return {
    id: entry.id,
    type: entry.type,
    reason: entry.reason,
    amount: Number(entry.amount),
    balanceAfter: Number(entry.balanceAfter),
    description: entry.description,
    createdAt: entry.createdAt,
  };
}

export function toPayoutDto(payout: PayoutRequest): PayoutRequestDto {
  return {
    id: payout.id,
    reference: payout.reference,
    driverId: payout.driverId,
    amount: Number(payout.amount),
    method: payout.method,
    status: payout.status,
    bankName: payout.bankName,
    accountTitle: payout.accountTitle,
    accountNumber: mask(payout.accountNumber) ?? '',
    rejectionReason: payout.rejectionReason,
    paymentReference: payout.paymentReference,
    processedAt: payout.processedAt,
    createdAt: payout.createdAt,
  };
}
