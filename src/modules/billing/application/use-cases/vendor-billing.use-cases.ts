import { Injectable } from '@nestjs/common';
import { SubscriptionInvoiceStatus, UserRole } from '@prisma/client';

import {
  BusinessRuleViolationException,
  ForbiddenOperationException,
  ResourceNotFoundException,
} from '@/common/exceptions/domain.exception';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import type { PaginatedResult } from '@/common/interfaces/paginated-result.interface';
import { RestaurantRepository } from '@/modules/restaurants/domain/repositories/restaurant.repository';

import {
  BillingRepository,
  type SubscriptionWithContext,
} from '../../domain/repositories/billing.repository';
import {
  toInvoiceDto,
  toSubscriptionDto,
  type SubscriptionInvoiceDto,
  type VendorBillingDto,
} from '../dto/billing-response.dto';
import type { ListInvoicesQueryDto, SubmitTransferDto } from '../dto/billing.dto';
import { BillingPricingService } from '../services/billing-pricing.service';

const STAFF_ROLES: UserRole[] = [UserRole.ADMIN, UserRole.SUPER_ADMIN];

/**
 * Decides whether this caller may see a listing's money.
 *
 * Owners only, never `VENDOR_STAFF`: a kitchen account manages orders and the
 * menu, and what the owner pays the platform is none of its business. Support
 * staff are let through because "why is my restaurant closed" is a question
 * they have to be able to answer.
 */
@Injectable()
export class VendorBillingAccessService {
  constructor(
    private readonly restaurants: RestaurantRepository,
    private readonly billing: BillingRepository,
  ) {}

  async loadSubscription(
    restaurantId: string,
    actor: AuthenticatedUser,
  ): Promise<SubscriptionWithContext> {
    const restaurant = await this.restaurants.findById(restaurantId);

    if (restaurant === null) {
      throw new ResourceNotFoundException('Restaurant', restaurantId);
    }

    this.assertMayView(restaurant.ownerId, actor);

    const subscription = await this.billing.findSubscriptionForRestaurant(restaurantId);

    if (subscription === null) {
      // Billing begins at approval. A listing still in the review queue has no
      // subscription yet, and saying so beats a 404 that reads like a bug.
      throw new ResourceNotFoundException(
        'Billing has not started for this listing. It begins the day the listing is approved.',
      );
    }

    return subscription;
  }

  assertMayView(ownerId: string, actor: AuthenticatedUser): void {
    if (STAFF_ROLES.includes(actor.role)) {
      return;
    }

    if (actor.id !== ownerId) {
      throw new ForbiddenOperationException(
        'Only the owner of this listing can see its subscription.',
      );
    }
  }

  /** Paying is the owner's alone — support may look, never transfer on their behalf. */
  assertMayPay(ownerId: string, actor: AuthenticatedUser): void {
    if (actor.id !== ownerId) {
      throw new ForbiddenOperationException(
        'Only the owner of this listing can submit a payment for it.',
      );
    }
  }
}

@Injectable()
export class GetVendorBillingUseCase {
  constructor(
    private readonly access: VendorBillingAccessService,
    private readonly billing: BillingRepository,
    private readonly pricing: BillingPricingService,
  ) {}

  /** The vendor's billing screen: where they stand, what is owed, where to pay. */
  async execute(restaurantId: string, actor: AuthenticatedUser): Promise<VendorBillingDto> {
    const subscription = await this.access.loadSubscription(restaurantId, actor);

    const [effectiveFee, payTo, invoices] = await Promise.all([
      this.pricing.effectiveFee(subscription),
      this.pricing.payToQrCodes(),
      this.billing.findInvoices({ page: 1, limit: 1, subscriptionId: subscription.id }),
    ]);

    // The newest invoice is the one that matters: it is either what they owe or
    // the receipt for what they last paid.
    const latest = invoices.items[0] ?? null;
    const outstanding =
      latest !== null &&
      (latest.status === SubscriptionInvoiceStatus.OPEN ||
        latest.status === SubscriptionInvoiceStatus.PENDING_REVIEW)
        ? latest
        : null;

    return {
      subscription: toSubscriptionDto(subscription, { effectiveFee }),
      currentInvoice: outstanding === null ? null : toInvoiceDto(outstanding),
      payTo,
    };
  }
}

@Injectable()
export class ListVendorInvoicesUseCase {
  constructor(
    private readonly access: VendorBillingAccessService,
    private readonly billing: BillingRepository,
  ) {}

  async execute(
    restaurantId: string,
    query: ListInvoicesQueryDto,
    actor: AuthenticatedUser,
  ): Promise<PaginatedResult<SubscriptionInvoiceDto>> {
    const subscription = await this.access.loadSubscription(restaurantId, actor);

    const page = await this.billing.findInvoices({
      page: query.page,
      limit: query.limit,
      subscriptionId: subscription.id,
      status: query.status,
      from: query.from,
      to: query.to,
    });

    return { items: page.items.map((invoice) => toInvoiceDto(invoice)), meta: page.meta };
  }
}

@Injectable()
export class SubmitVendorTransferUseCase {
  constructor(
    private readonly access: VendorBillingAccessService,
    private readonly billing: BillingRepository,
  ) {}

  /**
   * Records that the vendor says they have paid.
   *
   * It does not settle the invoice. There is no gateway behind a QR transfer,
   * so the only party who can confirm the money arrived is the one it arrived
   * with — and that is the platform, not the person claiming to have sent it.
   */
  async execute(
    invoiceId: string,
    dto: SubmitTransferDto,
    actor: AuthenticatedUser,
  ): Promise<SubscriptionInvoiceDto> {
    const invoice = await this.billing.findInvoiceById(invoiceId);

    if (invoice === null) {
      throw new ResourceNotFoundException('Invoice', invoiceId);
    }

    this.access.assertMayPay(invoice.subscription.ownerId, actor);

    if (invoice.status === SubscriptionInvoiceStatus.PAID) {
      throw new BusinessRuleViolationException('This invoice has already been paid.');
    }

    if (invoice.status === SubscriptionInvoiceStatus.VOID) {
      throw new BusinessRuleViolationException(
        'This invoice was waived, so there is nothing to pay.',
      );
    }

    if (invoice.status === SubscriptionInvoiceStatus.PENDING_REVIEW) {
      throw new BusinessRuleViolationException(
        'We are already checking a transfer for this invoice. You will hear from us shortly.',
      );
    }

    const updated = await this.billing.submitTransfer({
      invoiceId: invoice.id,
      channel: dto.channel,
      reference: dto.reference ?? null,
      proofImageUrl: dto.proofImageUrl ?? null,
      submittedById: actor.id,
    });

    return toInvoiceDto(updated);
  }
}
