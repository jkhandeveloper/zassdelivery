import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  AssignmentStatus,
  DriverAvailability,
  DriverDocumentType,
  DriverStatus,
  PayoutMethod,
  PayoutStatus,
  VehicleType,
} from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsDate,
  IsEnum,
  IsIn,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

import { PaginationQueryDto } from '@/common/dto/pagination-query.dto';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/** Strips the dashes Pakistani CNICs are usually written with. */
const digitsOnly = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.replace(/\D/g, '') : value;

const toBoolean = ({ value }: { value: unknown }): unknown => {
  if (typeof value === 'boolean') {
    return value;
  }
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  return value;
};

// ── Registration and profile ───────────────────────────────────

export class RiderVehicleDto {
  @ApiProperty({ enum: VehicleType, default: VehicleType.MOTORCYCLE })
  @IsEnum(VehicleType)
  type!: VehicleType;

  @ApiPropertyOptional({ example: 'Honda', maxLength: 60 })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  @Transform(trim)
  make?: string;

  @ApiPropertyOptional({ example: 'CD 70', maxLength: 60 })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  @Transform(trim)
  model?: string;

  @ApiPropertyOptional({ example: 2021, minimum: 1980, maximum: 2100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1980)
  @Max(2100)
  year?: number;

  @ApiPropertyOptional({ example: 'Red', maxLength: 40 })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  @Transform(trim)
  color?: string;

  @ApiPropertyOptional({
    example: 'PES-1234',
    description: 'Registration plate. Not required on foot or by bicycle.',
    maxLength: 20,
  })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  plateNumber?: string;
}

export class PayoutDetailsDto {
  @ApiPropertyOptional({ example: 'Meezan Bank', maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Transform(trim)
  bankName?: string;

  @ApiPropertyOptional({
    example: 'Ahmad Khan',
    description: 'Name the account is held in; transfers fail when it disagrees.',
    maxLength: 120,
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Transform(trim)
  accountTitle?: string;

  @ApiPropertyOptional({ example: '03001234567', maxLength: 40 })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  @Transform(trim)
  accountNumber?: string;
}

export class RegisterRiderDto {
  @ApiProperty({
    example: '1710112345678',
    description: 'CNIC, 13 digits. Dashes are accepted and stripped.',
  })
  @Transform(digitsOnly)
  @IsString()
  @Matches(/^\d{13}$/, { message: 'cnic must be the 13 digits of a Pakistani CNIC' })
  cnic!: string;

  @ApiPropertyOptional({
    example: 'KPK-2019-887766',
    description: 'Required before approval for motorised vehicles.',
    maxLength: 40,
  })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  @Transform(trim)
  licenseNumber?: string;

  @ApiPropertyOptional({
    description: 'Home delivery zone. Dispatch prefers riders based in the order’s zone.',
  })
  @IsOptional()
  @IsString()
  zoneId?: string;

  @ApiProperty({ type: RiderVehicleDto })
  @Type(() => RiderVehicleDto)
  vehicle!: RiderVehicleDto;

  @ApiPropertyOptional({
    type: PayoutDetailsDto,
    description: 'Can be supplied later, but withdrawals are blocked until it is.',
  })
  @IsOptional()
  @Type(() => PayoutDetailsDto)
  payout?: PayoutDetailsDto;
}

export class UpdateRiderDto {
  @ApiPropertyOptional({ example: 'KPK-2019-887766', maxLength: 40 })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  @Transform(trim)
  licenseNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  zoneId?: string;

  @ApiPropertyOptional({ type: PayoutDetailsDto })
  @IsOptional()
  @Type(() => PayoutDetailsDto)
  payout?: PayoutDetailsDto;
}

// ── Documents ──────────────────────────────────────────────────

export class UploadDocumentDto {
  @ApiProperty({ enum: DriverDocumentType })
  @IsEnum(DriverDocumentType)
  type!: DriverDocumentType;

  @ApiProperty({
    example: 'https://cdn.zassdelivery.pk/riders/cnic-front.jpg',
    description: 'Location of the uploaded file. Re-uploading replaces the previous one.',
    maxLength: 500,
  })
  @IsUrl({ require_protocol: true }, { message: 'fileUrl must be an absolute URL' })
  @MaxLength(500)
  fileUrl!: string;

  @ApiPropertyOptional({
    example: '1710112345678',
    description: 'The number printed on the document, where it has one.',
    maxLength: 60,
  })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  @Transform(trim)
  number?: string;

  @ApiPropertyOptional({
    example: '2029-12-31T00:00:00.000Z',
    description: 'Expiry, for licences and registrations. An expired document blocks approval.',
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate({ message: 'expiresAt must be a valid ISO 8601 date' })
  expiresAt?: Date;
}

export class RejectDocumentDto {
  @ApiProperty({
    example: 'The CNIC photo is too blurred to read the number.',
    description: 'Shown to the rider so they know what to re-upload.',
    maxLength: 300,
  })
  @IsString()
  @MinLength(5, { message: 'reason must explain what is wrong with the document' })
  @MaxLength(300)
  @Transform(trim)
  reason!: string;
}

// ── Approval ───────────────────────────────────────────────────

export class RejectRiderDto {
  @ApiProperty({ example: 'CNIC could not be verified.', maxLength: 300 })
  @IsString()
  @MinLength(5, { message: 'reason must explain why the application was rejected' })
  @MaxLength(300)
  @Transform(trim)
  reason!: string;
}

export class SuspendRiderDto {
  @ApiProperty({ example: 'Repeated late deliveries under investigation.', maxLength: 300 })
  @IsString()
  @MinLength(5)
  @MaxLength(300)
  @Transform(trim)
  reason!: string;
}

// ── Availability ───────────────────────────────────────────────

/** The states a rider may put themselves in. ON_DELIVERY is set by dispatch. */
const SELF_SERVICE_AVAILABILITY = [
  DriverAvailability.ONLINE,
  DriverAvailability.OFFLINE,
  DriverAvailability.ON_BREAK,
] as const;

export class SetAvailabilityDto {
  @ApiProperty({
    enum: SELF_SERVICE_AVAILABILITY,
    description:
      'ON_DELIVERY is not settable: it is what accepting a delivery does, and ' +
      'clears itself when the delivery ends.',
  })
  @IsIn(SELF_SERVICE_AVAILABILITY, {
    message: `availability must be one of: ${SELF_SERVICE_AVAILABILITY.join(', ')}`,
  })
  availability!: (typeof SELF_SERVICE_AVAILABILITY)[number];

  @ApiPropertyOptional({
    example: 34.0151,
    description: 'Position when going online, so the first offer can be ranked sensibly.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsLatitude({ message: 'latitude must be between -90 and 90' })
  latitude?: number;

  @ApiPropertyOptional({ example: 71.7938 })
  @IsOptional()
  @Type(() => Number)
  @IsLongitude({ message: 'longitude must be between -180 and 180' })
  longitude?: number;
}

export class UpdateLocationDto {
  @ApiProperty({ example: 34.0151 })
  @Type(() => Number)
  @IsLatitude({ message: 'latitude must be between -90 and 90' })
  latitude!: number;

  @ApiProperty({ example: 71.7938 })
  @Type(() => Number)
  @IsLongitude({ message: 'longitude must be between -180 and 180' })
  longitude!: number;
}

// ── Dispatch ───────────────────────────────────────────────────

export class AssignOrderDto {
  @ApiPropertyOptional({
    description:
      'Rider to offer the order to. Omit to let the dispatcher pick the best ' +
      'available rider automatically.',
  })
  @IsOptional()
  @IsString()
  driverId?: string;

  @ApiPropertyOptional({
    description: 'Seconds the rider has to answer. Defaults to the platform setting.',
    minimum: 15,
    maximum: 600,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(15)
  @Max(600)
  timeoutSeconds?: number;
}

export class RejectOfferDto {
  @ApiPropertyOptional({
    example: 'Too far from my current location.',
    description: 'Recorded against the offer; the order is passed to another rider.',
    maxLength: 300,
  })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  @Transform(trim)
  reason?: string;
}

export class CancelAssignmentDto {
  @ApiProperty({ example: 'Rider unreachable for ten minutes.', maxLength: 300 })
  @IsString()
  @MinLength(5)
  @MaxLength(300)
  @Transform(trim)
  reason!: string;
}

export class ConfirmDeliveryDto {
  @ApiProperty({
    example: '4821',
    description: 'The four-digit code the customer reads out at the door.',
  })
  @Transform(digitsOnly)
  @IsString()
  @Matches(/^\d{4}$/, { message: 'code must be the four digits given to the customer' })
  code!: string;
}

// ── Withdrawals ────────────────────────────────────────────────

export class RequestPayoutDto {
  @ApiProperty({
    example: 2500,
    description: 'Amount in PKR. Held out of the wallet as soon as the request is made.',
    minimum: 1,
  })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  @Max(1000000)
  amount!: number;

  @ApiProperty({ enum: PayoutMethod, default: PayoutMethod.BANK_TRANSFER })
  @IsEnum(PayoutMethod)
  method!: PayoutMethod;
}

export class RejectPayoutDto {
  @ApiProperty({ example: 'Account title does not match the CNIC.', maxLength: 300 })
  @IsString()
  @MinLength(5)
  @MaxLength(300)
  @Transform(trim)
  reason!: string;
}

export class MarkPayoutPaidDto {
  @ApiPropertyOptional({
    example: 'IBFT-99881234',
    description: 'Bank or gateway reference for the transfer.',
    maxLength: 120,
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Transform(trim)
  paymentReference?: string;
}

// ── Queries ────────────────────────────────────────────────────

export const RIDER_SORT_FIELDS = ['createdAt', 'rating', 'totalDeliveries'] as const;

export class ListRidersQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Matches name, phone or CNIC.', example: 'Bilal' })
  declare search?: string;

  @ApiPropertyOptional({ enum: RIDER_SORT_FIELDS, default: 'createdAt' })
  @IsOptional()
  @IsIn(RIDER_SORT_FIELDS, { message: `sortBy must be one of: ${RIDER_SORT_FIELDS.join(', ')}` })
  declare sortBy?: (typeof RIDER_SORT_FIELDS)[number];

  @ApiPropertyOptional({
    enum: DriverStatus,
    description: 'Filter by application state; PENDING_APPROVAL works the review queue.',
  })
  @IsOptional()
  @IsEnum(DriverStatus)
  status?: DriverStatus;

  @ApiPropertyOptional({ enum: DriverAvailability })
  @IsOptional()
  @IsEnum(DriverAvailability)
  availability?: DriverAvailability;

  @ApiPropertyOptional({ description: 'Filter by home zone.' })
  @IsOptional()
  @IsString()
  zoneId?: string;
}

export const ASSIGNMENT_SORT_FIELDS = ['offeredAt', 'respondedAt', 'completedAt'] as const;

export class ListAssignmentsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ASSIGNMENT_SORT_FIELDS, default: 'offeredAt' })
  @IsOptional()
  @IsIn(ASSIGNMENT_SORT_FIELDS, {
    message: `sortBy must be one of: ${ASSIGNMENT_SORT_FIELDS.join(', ')}`,
  })
  declare sortBy?: (typeof ASSIGNMENT_SORT_FIELDS)[number];

  @ApiPropertyOptional({ enum: AssignmentStatus })
  @IsOptional()
  @IsEnum(AssignmentStatus)
  status?: AssignmentStatus;

  @ApiPropertyOptional({
    description: 'Only offers still open and unanswered — the rider’s inbox.',
    default: false,
  })
  @IsOptional()
  @Transform(toBoolean)
  liveOnly?: boolean;

  @ApiPropertyOptional({ example: '2026-08-01T00:00:00.000Z' })
  @IsOptional()
  @Type(() => Date)
  @IsDate({ message: 'from must be a valid ISO 8601 date' })
  from?: Date;

  @ApiPropertyOptional({ example: '2026-08-31T23:59:59.999Z' })
  @IsOptional()
  @Type(() => Date)
  @IsDate({ message: 'to must be a valid ISO 8601 date' })
  to?: Date;
}

export const EARNING_SORT_FIELDS = ['earnedAt', 'amount'] as const;

export class ListEarningsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: EARNING_SORT_FIELDS, default: 'earnedAt' })
  @IsOptional()
  @IsIn(EARNING_SORT_FIELDS, {
    message: `sortBy must be one of: ${EARNING_SORT_FIELDS.join(', ')}`,
  })
  declare sortBy?: (typeof EARNING_SORT_FIELDS)[number];

  @ApiPropertyOptional({ example: '2026-08-01T00:00:00.000Z' })
  @IsOptional()
  @Type(() => Date)
  @IsDate({ message: 'from must be a valid ISO 8601 date' })
  from?: Date;

  @ApiPropertyOptional({ example: '2026-08-31T23:59:59.999Z' })
  @IsOptional()
  @Type(() => Date)
  @IsDate({ message: 'to must be a valid ISO 8601 date' })
  to?: Date;
}

export const PAYOUT_SORT_FIELDS = ['createdAt', 'amount', 'processedAt'] as const;

export class ListPayoutsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: PAYOUT_SORT_FIELDS, default: 'createdAt' })
  @IsOptional()
  @IsIn(PAYOUT_SORT_FIELDS, { message: `sortBy must be one of: ${PAYOUT_SORT_FIELDS.join(', ')}` })
  declare sortBy?: (typeof PAYOUT_SORT_FIELDS)[number];

  @ApiPropertyOptional({ enum: PayoutStatus })
  @IsOptional()
  @IsEnum(PayoutStatus)
  status?: PayoutStatus;

  @ApiPropertyOptional({ description: 'Staff view: filter by rider.' })
  @IsOptional()
  @IsString()
  driverId?: string;

  @ApiPropertyOptional({ example: '2026-08-01T00:00:00.000Z' })
  @IsOptional()
  @Type(() => Date)
  @IsDate({ message: 'from must be a valid ISO 8601 date' })
  from?: Date;

  @ApiPropertyOptional({ example: '2026-08-31T23:59:59.999Z' })
  @IsOptional()
  @Type(() => Date)
  @IsDate({ message: 'to must be a valid ISO 8601 date' })
  to?: Date;
}
