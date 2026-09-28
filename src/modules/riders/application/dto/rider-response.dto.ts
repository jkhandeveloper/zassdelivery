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
  RiderSettlementDirection,
  VehicleType,
  type DriverEarning,
  type DriverDocument,
} from '@prisma/client';

import { PaymentQrCodeDto, toPaymentQrCodes } from '@/common/dto/payment-qr-code.dto';

import type { AssignmentWithOrder } from '../../domain/repositories/assignment.repository';
import type {
  LedgerEntryWithContext,
  RestaurantBalance,
  RiderBalance,
  SettlementTotals,
  SettlementWithContext,
} from '../../domain/repositories/rider-finance.repository';
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

  @ApiPropertyOptional({
    type: [PaymentQrCodeDto],
    description:
      'The QR codes customers can scan to pay this rider at the door. Returned with ' +
      'the payout details — to the rider and to staff.',
  })
  paymentQrCodes?: PaymentQrCodeDto[];

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
  @ApiProperty({
    example: 150,
    description: 'Delivery fee plus tip: what the rider keeps for this run.',
  })
  riderFee!: number;
  @ApiProperty({
    example: 1090,
    description:
      'What the rider owes the business from the cash they collect: cashToCollect ' +
      'minus riderFee. Zero for prepaid orders, where the business owes the rider ' +
      'their fee instead.',
  })
  cashForRestaurant!: number;

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
  @ApiProperty({
    example: 105,
    description: 'The delivery fee, quoted before the tip, which may still change.',
  })
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

// ── Rider ↔ restaurant settlement ──────────────────────────────

export class SettlementTotalsDto {
  @ApiProperty({ example: 14 }) deliveries!: number;
  @ApiProperty({ example: 12400, description: 'Order money the rider took from customers.' })
  cashCollected!: number;
  @ApiProperty({ example: 1260, description: 'Delivery fees and tips the rider kept.' })
  riderFees!: number;
  @ApiProperty({ example: 9000, description: 'Cash the business has confirmed receiving.' })
  cashHandedOver!: number;
  @ApiProperty({ example: 0, description: 'Fees the rider has confirmed receiving.' })
  feesPaid!: number;
  @ApiProperty({
    example: 2140,
    description:
      'What the rider owes the business right now. Negative when the business ' + 'owes the rider.',
  })
  balance!: number;
  @ApiPropertyOptional({ nullable: true }) lastActivityAt!: Date | null;
}

/** The rider's view: one row per restaurant they have delivered for. */
export class RestaurantBalanceDto extends SettlementTotalsDto {
  @ApiProperty() restaurantId!: string;
  @ApiProperty({ example: 'Chapli Kabab House' }) restaurantName!: string;
  @ApiPropertyOptional({ nullable: true }) restaurantPhone!: string | null;
  @ApiProperty({ example: 'Main GT Road, Pabbi' }) restaurantAddress!: string;
}

/** The restaurant's view: one row per rider who has delivered for it. */
export class RiderBalanceDto extends SettlementTotalsDto {
  @ApiProperty() driverId!: string;
  @ApiProperty({ example: 'Bilal Ahmed' }) riderName!: string;
  @ApiProperty({ example: '+923005551234' }) riderPhone!: string;
  @ApiProperty({
    type: [PaymentQrCodeDto],
    description: 'Where the business can send the rider the fees it owes.',
  })
  paymentQrCodes!: PaymentQrCodeDto[];
}

export class RiderLedgerEntryDto {
  @ApiProperty() id!: string;
  @ApiProperty() orderId!: string;
  @ApiProperty({ example: 'ZD-260809-0007' }) orderNumber!: string;
  @ApiProperty({ enum: PaymentMethod }) paymentMethod!: PaymentMethod;
  @ApiProperty() driverId!: string;
  @ApiProperty({ example: 'Bilal Ahmed' }) riderName!: string;
  @ApiProperty() restaurantId!: string;
  @ApiProperty({ example: 'Chapli Kabab House' }) restaurantName!: string;
  @ApiProperty({ example: 1240, description: 'Zero when the business was paid directly.' })
  collectedAmount!: number;
  @ApiProperty({ example: 150, description: 'Delivery fee plus tip, kept by the rider.' })
  riderFee!: number;
  @ApiProperty({
    example: 1090,
    description: 'Positive: the rider owes the business. Negative: the business owes the rider.',
  })
  netAmount!: number;
  @ApiProperty() createdAt!: Date;
}

export class RiderSettlementDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: RiderSettlementDirection }) direction!: RiderSettlementDirection;
  @ApiProperty({ example: 2000 }) amount!: number;
  @ApiPropertyOptional({ nullable: true }) note!: string | null;
  @ApiProperty() driverId!: string;
  @ApiProperty({ example: 'Bilal Ahmed' }) riderName!: string;
  @ApiProperty() restaurantId!: string;
  @ApiProperty({ example: 'Chapli Kabab House' }) restaurantName!: string;
  @ApiPropertyOptional({ nullable: true, description: 'Who confirmed receiving the money.' })
  recordedByName!: string | null;
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
  @ApiProperty({
    example: 'Delivery confirmed. Keep Rs. 150 and hand Rs. 1090 to Chapli Kabab House.',
  })
  message!: string;
  @ApiProperty({ example: 150, description: 'Delivery fee plus tip.' }) earned!: number;
  @ApiProperty({ type: [EarningDto] }) breakdown!: EarningDto[];
  @ApiProperty({ example: 1240, description: 'Money you took from the customer.' })
  collected!: number;
  @ApiProperty({ example: 1090, description: 'What you now owe the business for this order.' })
  owedToRestaurant!: number;
  @ApiProperty({ example: 0, description: 'What the business now owes you for this order.' })
  owedByRestaurant!: number;
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
      paymentQrCodes: toPaymentQrCodes(rider.paymentQrCodes),
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

  // Only an unpaid cash order leaves the rider holding money. Showing a figure
  // for a prepaid order is how riders end up asking for it twice.
  const cashToCollect =
    order.paymentMethod === PaymentMethod.CASH_ON_DELIVERY &&
    order.paymentStatus !== PaymentStatus.PAID
      ? Number(order.totalAmount)
      : 0;
  const riderFee = Number(order.deliveryFee) + Number(order.tipAmount);

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
      cashToCollect,
      riderFee,
      cashForRestaurant: cashToCollect === 0 ? 0 : Math.max(0, cashToCollect - riderFee),
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

function toTotalsDto(totals: SettlementTotals): SettlementTotalsDto {
  return {
    deliveries: totals.deliveries,
    cashCollected: totals.cashCollected,
    riderFees: totals.riderFees,
    cashHandedOver: totals.cashHandedOver,
    feesPaid: totals.feesPaid,
    balance: totals.balance,
    lastActivityAt: totals.lastActivityAt,
  };
}

export function toRestaurantBalanceDto(row: RestaurantBalance): RestaurantBalanceDto {
  return {
    ...toTotalsDto(row),
    restaurantId: row.restaurantId,
    restaurantName: row.restaurant.name,
    restaurantPhone: row.restaurant.phone,
    restaurantAddress: row.restaurant.addressLine,
  };
}

export function toRiderBalanceDto(row: RiderBalance): RiderBalanceDto {
  return {
    ...toTotalsDto(row),
    driverId: row.driverId,
    riderName: row.driver.fullName,
    riderPhone: row.driver.phone,
    paymentQrCodes: toPaymentQrCodes(row.driver.paymentQrCodes),
  };
}

export function toLedgerEntryDto(entry: LedgerEntryWithContext): RiderLedgerEntryDto {
  return {
    id: entry.id,
    orderId: entry.orderId,
    orderNumber: entry.order.orderNumber,
    paymentMethod: entry.order.paymentMethod,
    driverId: entry.driverId,
    riderName: entry.driver.user.fullName,
    restaurantId: entry.restaurantId,
    restaurantName: entry.restaurant.name,
    collectedAmount: Number(entry.collectedAmount),
    riderFee: Number(entry.riderFee),
    netAmount: Number(entry.netAmount),
    createdAt: entry.createdAt,
  };
}

export function toSettlementDto(settlement: SettlementWithContext): RiderSettlementDto {
  return {
    id: settlement.id,
    direction: settlement.direction,
    amount: Number(settlement.amount),
    note: settlement.note,
    driverId: settlement.driverId,
    riderName: settlement.driver.user.fullName,
    restaurantId: settlement.restaurantId,
    restaurantName: settlement.restaurant.name,
    recordedByName: settlement.recordedBy?.fullName ?? null,
    createdAt: settlement.createdAt,
  };
}
