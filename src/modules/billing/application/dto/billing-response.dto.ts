import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SubscriptionInvoiceStatus, SubscriptionStatus } from '@prisma/client';

import { PaymentQrCodeDto, type PaymentQrProvider } from '@/common/dto/payment-qr-code.dto';

import { daysUntil } from '../../domain/services/billing-schedule';
import type {
  InvoiceWithContext,
  SubscriptionWithContext,
} from '../../domain/repositories/billing.repository';

/**
 * What each subscription state means to the person reading it.
 *
 * Written for the vendor rather than for us: "suspended" is a database word,
 * and somebody whose restaurant has just gone dark needs to be told what to do
 * about it in the same sentence.
 */
const SUBSCRIPTION_STATUS_TEXT: Record<SubscriptionStatus, string> = {
  [SubscriptionStatus.TRIALING]: 'Free first month — nothing to pay yet',
  [SubscriptionStatus.ACTIVE]: 'Paid up',
  [SubscriptionStatus.PAST_DUE]: 'Payment overdue — pay now to stay open',
  [SubscriptionStatus.SUSPENDED]: 'Closed for non-payment — pay to reopen',
  [SubscriptionStatus.CANCELLED]: 'Cancelled',
};

const INVOICE_STATUS_TEXT: Record<SubscriptionInvoiceStatus, string> = {
  [SubscriptionInvoiceStatus.OPEN]: 'Awaiting payment',
  [SubscriptionInvoiceStatus.PENDING_REVIEW]: 'Checking your transfer',
  [SubscriptionInvoiceStatus.PAID]: 'Paid',
  [SubscriptionInvoiceStatus.VOID]: 'Waived',
};

/** The platform's standard rate — what a vendor pays without a deal of their own. */
export class DefaultFeeDto {
  @ApiProperty({ example: 2000 }) monthlyFee!: number;
  @ApiProperty({ example: 'PKR' }) currency!: string;
}

export class BillingOwnerDto {
  @ApiProperty() id!: string;
  @ApiProperty({ example: 'Imran Khan' }) fullName!: string;
  @ApiProperty({ example: '+923001234567' }) phone!: string;
}

export class BillingListingDto {
  @ApiProperty() id!: string;
  @ApiProperty({ example: 'Chapli Kabab House' }) name!: string;
  @ApiProperty({ example: 'chapli-kabab-house' }) slug!: string;
}

export class SubscriptionDto {
  @ApiProperty() id!: string;
  @ApiProperty({ type: BillingListingDto }) restaurant!: BillingListingDto;
  @ApiPropertyOptional({
    type: BillingOwnerDto,
    nullable: true,
    description: 'Who pays. Present on the administrator’s view only.',
  })
  owner!: BillingOwnerDto | null;

  @ApiProperty({ enum: SubscriptionStatus }) status!: SubscriptionStatus;
  @ApiProperty({ example: 'Paid up' }) statusText!: string;

  @ApiProperty({
    example: 2000,
    description:
      'What this vendor actually pays each month — their negotiated rate if ' +
      'they have one, otherwise the platform default.',
  })
  monthlyFee!: number;
  @ApiProperty({
    example: false,
    description: 'Whether that amount is a rate negotiated for this vendor alone.',
  })
  hasCustomRate!: boolean;
  @ApiProperty({ example: 'PKR' }) currency!: string;

  @ApiProperty() currentPeriodStart!: Date;
  @ApiProperty({ description: 'The next due date. Cycles are a fixed 30 days.' })
  currentPeriodEnd!: Date;
  @ApiProperty({
    example: 12,
    description: 'Whole days until the next payment falls due. Negative once it has passed.',
  })
  daysUntilDue!: number;

  @ApiPropertyOptional({ nullable: true }) trialEndsAt!: Date | null;
  @ApiProperty({ example: true, description: 'Still inside the free first month.' })
  isTrialing!: boolean;

  @ApiPropertyOptional({ nullable: true }) lastPaidAt!: Date | null;
  @ApiPropertyOptional({ nullable: true }) suspendedAt!: Date | null;
  @ApiProperty({
    example: false,
    description:
      'Whether it was non-payment that closed this listing. A listing an ' +
      'administrator closed for its own reasons is not reopened by paying.',
  })
  suspendedForNonPayment!: boolean;

  @ApiProperty() createdAt!: Date;
}

export class SubscriptionInvoiceDto {
  @ApiProperty() id!: string;
  @ApiProperty({ example: 'SUB-260912-0001' }) invoiceNumber!: string;
  @ApiProperty({ type: BillingListingDto }) restaurant!: BillingListingDto;
  @ApiPropertyOptional({ type: BillingOwnerDto, nullable: true }) owner!: BillingOwnerDto | null;

  @ApiProperty({ enum: SubscriptionInvoiceStatus }) status!: SubscriptionInvoiceStatus;
  @ApiProperty({ example: 'Awaiting payment' }) statusText!: string;

  @ApiProperty({ example: 2000 }) amount!: number;
  @ApiProperty({ example: 'PKR' }) currency!: string;

  @ApiProperty() periodStart!: Date;
  @ApiProperty() periodEnd!: Date;
  @ApiProperty({ description: 'The fee buys the month ahead, so this equals the period start.' })
  dueAt!: Date;
  @ApiProperty({ description: 'When an unpaid invoice takes the listing down.' })
  blockAt!: Date;
  @ApiProperty({ example: 3, description: 'Whole days until the due date; negative once past.' })
  daysUntilDue!: number;

  @ApiProperty({ example: false, description: 'The free first month.' }) isTrial!: boolean;

  @ApiPropertyOptional({ nullable: true, enum: ['JAZZCASH', 'EASYPAISA', 'BANK', 'OTHER'] })
  channel!: PaymentQrProvider | null;
  @ApiPropertyOptional({ nullable: true, description: 'The TID the vendor quoted.' })
  reference!: string | null;
  @ApiPropertyOptional({ nullable: true }) proofImageUrl!: string | null;
  @ApiPropertyOptional({ nullable: true }) submittedAt!: Date | null;

  @ApiPropertyOptional({ nullable: true }) paidAt!: Date | null;
  @ApiPropertyOptional({ nullable: true }) rejectionReason!: string | null;
  @ApiPropertyOptional({ nullable: true }) voidReason!: string | null;

  @ApiProperty() createdAt!: Date;
}

/** The vendor's whole billing screen in one response. */
export class VendorBillingDto {
  @ApiProperty({ type: SubscriptionDto }) subscription!: SubscriptionDto;
  @ApiPropertyOptional({
    type: SubscriptionInvoiceDto,
    nullable: true,
    description: 'What is owed right now, if anything.',
  })
  currentInvoice!: SubscriptionInvoiceDto | null;
  @ApiProperty({
    type: [PaymentQrCodeDto],
    description:
      'Where to send the money — the platform’s own wallet and bank QR codes. ' +
      'Empty means nobody has configured them yet, and the vendor cannot pay.',
  })
  payTo!: PaymentQrCodeDto[];
}

function toOwner(
  owner: { id: string; fullName: string; phone: string } | null,
): BillingOwnerDto | null {
  return owner === null ? null : { id: owner.id, fullName: owner.fullName, phone: owner.phone };
}

export function toSubscriptionDto(
  subscription: SubscriptionWithContext,
  options: { effectiveFee: number; includeOwner?: boolean; now?: Date },
): SubscriptionDto {
  const now = options.now ?? new Date();

  return {
    id: subscription.id,
    restaurant: {
      id: subscription.restaurant.id,
      name: subscription.restaurant.name,
      slug: subscription.restaurant.slug,
    },
    owner: options.includeOwner === true ? toOwner(subscription.owner) : null,
    status: subscription.status,
    statusText: SUBSCRIPTION_STATUS_TEXT[subscription.status],
    monthlyFee: options.effectiveFee,
    hasCustomRate: subscription.monthlyFee !== null,
    currency: subscription.currency,
    currentPeriodStart: subscription.currentPeriodStart,
    currentPeriodEnd: subscription.currentPeriodEnd,
    daysUntilDue: daysUntil(subscription.currentPeriodEnd, now),
    trialEndsAt: subscription.trialEndsAt,
    isTrialing: subscription.status === SubscriptionStatus.TRIALING,
    lastPaidAt: subscription.lastPaidAt,
    suspendedAt: subscription.suspendedAt,
    suspendedForNonPayment: subscription.suspendedByBilling,
    createdAt: subscription.createdAt,
  };
}

export function toInvoiceDto(
  invoice: InvoiceWithContext,
  options?: { includeOwner?: boolean; now?: Date },
): SubscriptionInvoiceDto {
  const now = options?.now ?? new Date();

  return {
    id: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    restaurant: {
      id: invoice.restaurant.id,
      name: invoice.restaurant.name,
      slug: invoice.restaurant.slug,
    },
    owner: options?.includeOwner === true ? toOwner(invoice.subscription.owner) : null,
    status: invoice.status,
    statusText: INVOICE_STATUS_TEXT[invoice.status],
    amount: Number(invoice.amount),
    currency: invoice.currency,
    periodStart: invoice.periodStart,
    periodEnd: invoice.periodEnd,
    dueAt: invoice.dueAt,
    blockAt: invoice.blockAt,
    daysUntilDue: daysUntil(invoice.dueAt, now),
    isTrial: invoice.isTrial,
    channel: (invoice.channel as PaymentQrProvider | null) ?? null,
    reference: invoice.reference,
    proofImageUrl: invoice.proofImageUrl,
    submittedAt: invoice.submittedAt,
    paidAt: invoice.paidAt,
    rejectionReason: invoice.rejectionReason,
    voidReason: invoice.voidReason,
    createdAt: invoice.createdAt,
  };
}
