import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  AuditAction,
  BannerPlacement,
  CouponType,
  SettingValueType,
  TicketCategory,
  TicketPriority,
  TicketStatus,
} from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDate,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

import { PaginationQueryDto } from '@/common/dto/pagination-query.dto';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

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

// ── Reporting window ───────────────────────────────────────────

export class ReportWindowDto {
  @ApiPropertyOptional({
    example: '2026-08-01T00:00:00.000Z',
    description: 'Defaults to 30 days ago.',
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate({ message: 'from must be a valid ISO 8601 date' })
  from?: Date;

  @ApiPropertyOptional({ example: '2026-08-31T23:59:59.999Z', description: 'Defaults to now.' })
  @IsOptional()
  @Type(() => Date)
  @IsDate({ message: 'to must be a valid ISO 8601 date' })
  to?: Date;
}

export class LeaderboardQueryDto extends ReportWindowDto {
  @ApiPropertyOptional({ default: 10, minimum: 1, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}

// ── Coupons ────────────────────────────────────────────────────

export class CreateCouponDto {
  @ApiProperty({
    example: 'ZASS100',
    description: 'Quoted by customers, so it is stored and matched upper-case.',
    maxLength: 40,
  })
  @IsString()
  @MinLength(3)
  @MaxLength(40)
  @Matches(/^[A-Za-z0-9_-]+$/, {
    message: 'code may contain only letters, digits, hyphens and underscores',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  code!: string;

  @ApiProperty({ enum: CouponType })
  @IsEnum(CouponType)
  type!: CouponType;

  @ApiProperty({
    example: 20,
    description: 'Percentage (1–100) for PERCENTAGE, otherwise an absolute PKR amount.',
  })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1000000)
  value!: number;

  @ApiPropertyOptional({
    example: 200,
    description: 'Ceiling on a percentage discount. Required for PERCENTAGE coupons.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  maxDiscountAmount?: number;

  @ApiPropertyOptional({ example: 500, default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  minOrderAmount?: number;

  @ApiPropertyOptional({ example: '20% off your first order', maxLength: 300 })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  @Transform(trim)
  description?: string;

  @ApiProperty({ example: '2026-08-10T00:00:00.000Z' })
  @Type(() => Date)
  @IsDate({ message: 'startsAt must be a valid ISO 8601 date' })
  startsAt!: Date;

  @ApiProperty({ example: '2026-09-10T00:00:00.000Z' })
  @Type(() => Date)
  @IsDate({ message: 'expiresAt must be a valid ISO 8601 date' })
  expiresAt!: Date;

  @ApiPropertyOptional({ example: 1000, description: 'Total redemptions. Omit for unlimited.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  usageLimit?: number;

  @ApiPropertyOptional({ example: 1, description: 'Redemptions per customer. Omit for unlimited.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  perUserLimit?: number;

  @ApiPropertyOptional({ description: 'Restrict to one restaurant.' })
  @IsOptional()
  @IsString()
  restaurantId?: string;

  @ApiPropertyOptional({ description: 'Restrict to one delivery zone.' })
  @IsOptional()
  @IsString()
  zoneId?: string;

  @ApiPropertyOptional({
    default: false,
    description: 'Only redeemable on a customer’s first order.',
  })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  firstOrderOnly?: boolean;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateCouponDto extends CreateCouponDto {
  @ApiPropertyOptional({ description: 'The code cannot be changed once redemptions exist.' })
  declare code: string;

  @ApiPropertyOptional({ enum: CouponType })
  declare type: CouponType;

  @ApiPropertyOptional()
  declare value: number;

  @ApiPropertyOptional()
  declare startsAt: Date;

  @ApiPropertyOptional()
  declare expiresAt: Date;
}

export const COUPON_SORT_FIELDS = ['createdAt', 'expiresAt', 'usageCount', 'value'] as const;

export class ListCouponsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Matches the code or description.' })
  declare search?: string;

  @ApiPropertyOptional({ enum: COUPON_SORT_FIELDS, default: 'createdAt' })
  @IsOptional()
  @IsIn(COUPON_SORT_FIELDS, { message: `sortBy must be one of: ${COUPON_SORT_FIELDS.join(', ')}` })
  declare sortBy?: (typeof COUPON_SORT_FIELDS)[number];

  @ApiPropertyOptional({ enum: CouponType })
  @IsOptional()
  @IsEnum(CouponType)
  type?: CouponType;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ description: 'Only coupons redeemable right now.', default: false })
  @IsOptional()
  @Transform(toBoolean)
  liveOnly?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  restaurantId?: string;
}

// ── Banners ────────────────────────────────────────────────────

export class CreateBannerDto {
  @ApiProperty({ example: 'Free delivery this weekend', maxLength: 160 })
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  @Transform(trim)
  title!: string;

  @ApiPropertyOptional({ example: 'On every order over Rs. 500', maxLength: 240 })
  @IsOptional()
  @IsString()
  @MaxLength(240)
  @Transform(trim)
  subtitle?: string;

  @ApiProperty({ example: 'https://cdn.zassdelivery.pk/banners/weekend.jpg', maxLength: 500 })
  @IsUrl({ require_protocol: true }, { message: 'imageUrl must be an absolute URL' })
  @MaxLength(500)
  imageUrl!: string;

  @ApiProperty({ enum: BannerPlacement, default: BannerPlacement.HOME_TOP })
  @IsEnum(BannerPlacement)
  placement!: BannerPlacement;

  @ApiPropertyOptional({ description: 'Deep-link to a restaurant.' })
  @IsOptional()
  @IsString()
  restaurantId?: string;

  @ApiPropertyOptional({ example: 'https://zassdelivery.pk/offers', maxLength: 500 })
  @IsOptional()
  @IsUrl({ require_protocol: true }, { message: 'linkUrl must be an absolute URL' })
  @MaxLength(500)
  linkUrl?: string;

  @ApiPropertyOptional({ description: 'Show only in one city. Omit to show everywhere.' })
  @IsOptional()
  @IsString()
  cityId?: string;

  @ApiPropertyOptional({ default: 0, description: 'Lower sorts first.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(9999)
  sortOrder?: number;

  @ApiPropertyOptional({ description: 'When it starts showing. Omit for immediately.' })
  @IsOptional()
  @Type(() => Date)
  @IsDate({ message: 'startsAt must be a valid ISO 8601 date' })
  startsAt?: Date;

  @ApiPropertyOptional({ description: 'When it stops. Omit for indefinitely.' })
  @IsOptional()
  @Type(() => Date)
  @IsDate({ message: 'endsAt must be a valid ISO 8601 date' })
  endsAt?: Date;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateBannerDto extends CreateBannerDto {
  @ApiPropertyOptional({ maxLength: 160 })
  declare title: string;

  @ApiPropertyOptional({ maxLength: 500 })
  declare imageUrl: string;

  @ApiPropertyOptional({ enum: BannerPlacement })
  declare placement: BannerPlacement;
}

export class BannerOrderEntryDto {
  @ApiProperty()
  @IsString()
  id!: string;

  @ApiProperty({ example: 0 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(9999)
  sortOrder!: number;
}

export class ReorderBannersDto {
  @ApiProperty({ type: [BannerOrderEntryDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => BannerOrderEntryDto)
  banners!: BannerOrderEntryDto[];
}

export class ListBannersQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: BannerPlacement })
  @IsOptional()
  @IsEnum(BannerPlacement)
  placement?: BannerPlacement;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  cityId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  isActive?: boolean;
}

// ── Settings ───────────────────────────────────────────────────

export class UpsertSettingDto {
  @ApiProperty({ example: 'platform.service_fee_percentage', maxLength: 120 })
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  @Matches(/^[a-z0-9_]+\.[a-z0-9_.]+$/, {
    message: 'key must look like "group.name", lower-case with underscores',
  })
  @Transform(trim)
  key!: string;

  @ApiProperty({ example: '5', maxLength: 2000 })
  @IsString()
  @MaxLength(2000)
  value!: string;

  @ApiPropertyOptional({ enum: SettingValueType, default: SettingValueType.STRING })
  @IsOptional()
  @IsEnum(SettingValueType)
  valueType?: SettingValueType;

  @ApiPropertyOptional({ example: 'pricing', default: 'general', maxLength: 60 })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  @Transform(trim)
  group?: string;

  @ApiPropertyOptional({ maxLength: 300 })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  @Transform(trim)
  description?: string;

  @ApiPropertyOptional({
    default: false,
    description: 'Public settings are readable by client apps; private ones never leave the API.',
  })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  isPublic?: boolean;
}

export class UpsertSettingsDto {
  @ApiProperty({ type: [UpsertSettingDto], description: 'Applied together or not at all.' })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => UpsertSettingDto)
  settings!: UpsertSettingDto[];
}

// ── Support tickets ────────────────────────────────────────────

export class CreateTicketDto {
  @ApiProperty({ enum: TicketCategory })
  @IsEnum(TicketCategory)
  category!: TicketCategory;

  @ApiProperty({ example: 'Two items were missing from my order', maxLength: 200 })
  @IsString()
  @MinLength(5)
  @MaxLength(200)
  @Transform(trim)
  subject!: string;

  @ApiProperty({
    example: 'I ordered two naan with the karahi and neither arrived.',
    maxLength: 4000,
  })
  @IsString()
  @MinLength(5)
  @MaxLength(4000)
  @Transform(trim)
  message!: string;

  @ApiPropertyOptional({ description: 'The order this is about, when there is one.' })
  @IsOptional()
  @IsString()
  orderId?: string;

  @ApiPropertyOptional({ enum: TicketPriority, default: TicketPriority.MEDIUM })
  @IsOptional()
  @IsEnum(TicketPriority)
  priority?: TicketPriority;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsUrl({ require_protocol: true })
  @MaxLength(500)
  attachmentUrl?: string;
}

export class AddTicketMessageDto {
  @ApiProperty({ example: 'We have refunded the missing items.', maxLength: 4000 })
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  @Transform(trim)
  message!: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsUrl({ require_protocol: true })
  @MaxLength(500)
  attachmentUrl?: string;

  @ApiPropertyOptional({
    default: false,
    description:
      'Staff only. An internal note is never shown to the customer — it is how ' +
      'agents hand a thread over without narrating it to the person waiting.',
  })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  isInternal?: boolean;
}

export class ChangeTicketStatusDto {
  @ApiProperty({ enum: TicketStatus })
  @IsEnum(TicketStatus)
  status!: TicketStatus;
}

export class AssignTicketDto {
  @ApiPropertyOptional({ description: 'Agent to assign. Omit to unassign.' })
  @IsOptional()
  @IsString()
  assigneeId?: string;
}

export class ChangeTicketPriorityDto {
  @ApiProperty({ enum: TicketPriority })
  @IsEnum(TicketPriority)
  priority!: TicketPriority;
}

export const TICKET_SORT_FIELDS = ['createdAt', 'updatedAt', 'priority'] as const;

export class ListTicketsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Matches the ticket number or subject.' })
  declare search?: string;

  @ApiPropertyOptional({ enum: TICKET_SORT_FIELDS, default: 'createdAt' })
  @IsOptional()
  @IsIn(TICKET_SORT_FIELDS, { message: `sortBy must be one of: ${TICKET_SORT_FIELDS.join(', ')}` })
  declare sortBy?: (typeof TICKET_SORT_FIELDS)[number];

  @ApiPropertyOptional({ enum: TicketStatus })
  @IsOptional()
  @IsEnum(TicketStatus)
  status?: TicketStatus;

  @ApiPropertyOptional({ enum: TicketPriority })
  @IsOptional()
  @IsEnum(TicketPriority)
  priority?: TicketPriority;

  @ApiPropertyOptional({ enum: TicketCategory })
  @IsOptional()
  @IsEnum(TicketCategory)
  category?: TicketCategory;

  @ApiPropertyOptional({ description: 'Staff view: filter by assigned agent.' })
  @IsOptional()
  @IsString()
  assignedToId?: string;

  @ApiPropertyOptional({ description: 'Staff view: filter by the customer who opened it.' })
  @IsOptional()
  @IsString()
  userId?: string;

  @ApiPropertyOptional({ description: 'Everything still awaiting somebody.', default: false })
  @IsOptional()
  @Transform(toBoolean)
  openOnly?: boolean;

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

// ── Audit log ──────────────────────────────────────────────────

export class ListAuditLogsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: AuditAction })
  @IsOptional()
  @IsEnum(AuditAction)
  action?: AuditAction;

  @ApiPropertyOptional({ example: 'Coupon', description: 'The kind of record that changed.' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  entityType?: string;

  @ApiPropertyOptional({ description: 'One specific record.' })
  @IsOptional()
  @IsString()
  entityId?: string;

  @ApiPropertyOptional({ description: 'Who did it.' })
  @IsOptional()
  @IsString()
  actorId?: string;

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
