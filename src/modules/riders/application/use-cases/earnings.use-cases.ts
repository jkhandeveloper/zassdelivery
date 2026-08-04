import { Injectable } from '@nestjs/common';
import { PayoutStatus } from '@prisma/client';

import {
  BusinessRuleViolationException,
  ForbiddenOperationException,
  ResourceNotFoundException,
} from '@/common/exceptions/domain.exception';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import type { PaginatedResult } from '@/common/interfaces/paginated-result.interface';
import { buildOrderBy } from '@/common/utils/pagination.util';

import { RiderFinanceRepository } from '../../domain/repositories/rider-finance.repository';
import {
  toEarningDto,
  toPayoutDto,
  toWalletTransactionDto,
  type EarningDto,
  type EarningsSummaryDto,
  type PayoutRequestDto,
  type RiderWalletDto,
  type WalletTransactionDto,
} from '../dto/rider-response.dto';
import {
  EARNING_SORT_FIELDS,
  PAYOUT_SORT_FIELDS,
  type ListEarningsQueryDto,
  type ListPayoutsQueryDto,
  type MarkPayoutPaidDto,
  type RejectPayoutDto,
  type RequestPayoutDto,
} from '../dto/rider.dto';
import { RiderSettingsService } from '../services/rider-settings.service';
import { RiderAccessService } from './rider-profile.use-cases';

@Injectable()
export class ListEarningsUseCase {
  constructor(
    private readonly finance: RiderFinanceRepository,
    private readonly access: RiderAccessService,
  ) {}

  async execute(
    actor: AuthenticatedUser,
    query: ListEarningsQueryDto,
  ): Promise<PaginatedResult<EarningDto>> {
    const rider = await this.access.mine(actor);
    const orderBy = buildOrderBy(query.sortBy, query.sortOrder, EARNING_SORT_FIELDS, 'earnedAt');

    const result = await this.finance.listEarnings({
      page: query.page,
      limit: query.limit,
      orderBy,
      driverId: rider.id,
      from: query.from,
      to: query.to,
    });

    return { items: result.items.map(toEarningDto), meta: result.meta };
  }
}

@Injectable()
export class EarningsSummaryUseCase {
  constructor(
    private readonly finance: RiderFinanceRepository,
    private readonly access: RiderAccessService,
  ) {}

  /** The header on the rider's earnings screen: today, this week, this month. */
  async execute(actor: AuthenticatedUser): Promise<EarningsSummaryDto> {
    const rider = await this.access.mine(actor);
    const summary = await this.finance.summarise(rider.id, new Date());

    return {
      ...summary,
      averagePerDelivery:
        summary.deliveriesLifetime === 0
          ? 0
          : Math.round((summary.lifetime / summary.deliveriesLifetime) * 100) / 100,
    };
  }
}

@Injectable()
export class GetRiderWalletUseCase {
  constructor(
    private readonly finance: RiderFinanceRepository,
    private readonly access: RiderAccessService,
  ) {}

  async execute(actor: AuthenticatedUser): Promise<RiderWalletDto> {
    const rider = await this.access.mine(actor);
    const wallet = await this.finance.walletFor(rider.userId);

    return {
      balance: wallet.balance,
      currency: wallet.currency,
      isLocked: wallet.isLocked,
      pendingWithdrawals: wallet.pendingWithdrawals,
      // The held amount has already left the balance, so this is the balance
      // itself — surfaced explicitly because riders read "balance" as "money I
      // can take out today", and a request in flight makes that untrue.
      availableToWithdraw: wallet.isLocked ? 0 : wallet.balance,
    };
  }
}

@Injectable()
export class ListWalletTransactionsUseCase {
  constructor(
    private readonly finance: RiderFinanceRepository,
    private readonly access: RiderAccessService,
  ) {}

  async execute(
    actor: AuthenticatedUser,
    page: number,
    limit: number,
  ): Promise<PaginatedResult<WalletTransactionDto>> {
    const rider = await this.access.mine(actor);
    const result = await this.finance.listWalletTransactions(rider.userId, page, limit);

    return { items: result.items.map(toWalletTransactionDto), meta: result.meta };
  }
}

@Injectable()
export class RequestPayoutUseCase {
  constructor(
    private readonly finance: RiderFinanceRepository,
    private readonly access: RiderAccessService,
    private readonly settings: RiderSettingsService,
  ) {}

  /**
   * Asks for wallet money to be transferred out.
   *
   * The amount is debited as the request is created, so it cannot be spent
   * while an operator is still deciding. Every check here is repeated inside
   * that transaction: a balance read beforehand is stale by the time it
   * matters.
   */
  async execute(actor: AuthenticatedUser, dto: RequestPayoutDto): Promise<PayoutRequestDto> {
    const rider = await this.access.mine(actor);

    if (rider.payoutAccountTitle === null || rider.payoutAccountNumber === null) {
      throw new BusinessRuleViolationException(
        'Add your payout account details to your profile before requesting a withdrawal.',
      );
    }

    // One request in flight at a time. Two concurrent holds against the same
    // balance is exactly the kind of arithmetic nobody wants to unpick later.
    if (await this.finance.hasOpenPayout(rider.id)) {
      throw new BusinessRuleViolationException(
        'You already have a withdrawal being processed. Wait for it to complete before requesting another.',
      );
    }

    const minimum = await this.settings.minimumWithdrawal();

    if (dto.amount < minimum) {
      throw new BusinessRuleViolationException(`The smallest withdrawal is Rs. ${minimum}.`);
    }

    const wallet = await this.finance.walletFor(rider.userId);

    if (wallet.isLocked) {
      throw new ForbiddenOperationException(
        'Your wallet is currently locked. Contact support for details.',
      );
    }

    if (dto.amount > wallet.balance) {
      throw new BusinessRuleViolationException(
        `You have Rs. ${wallet.balance} available to withdraw.`,
      );
    }

    return toPayoutDto(
      await this.finance.requestPayout({
        driverId: rider.id,
        userId: rider.userId,
        amount: dto.amount,
        method: dto.method,
        bankName: rider.payoutBankName,
        accountTitle: rider.payoutAccountTitle,
        accountNumber: rider.payoutAccountNumber,
      }),
    );
  }
}

@Injectable()
export class ListPayoutsUseCase {
  constructor(
    private readonly finance: RiderFinanceRepository,
    private readonly access: RiderAccessService,
  ) {}

  /** The rider's own withdrawal history. */
  async mine(
    actor: AuthenticatedUser,
    query: ListPayoutsQueryDto,
  ): Promise<PaginatedResult<PayoutRequestDto>> {
    const rider = await this.access.mine(actor);

    return this.list(query, rider.id);
  }

  /** The operator queue, across every rider. */
  async all(query: ListPayoutsQueryDto): Promise<PaginatedResult<PayoutRequestDto>> {
    return this.list(query, query.driverId);
  }

  private async list(
    query: ListPayoutsQueryDto,
    driverId: string | undefined,
  ): Promise<PaginatedResult<PayoutRequestDto>> {
    const orderBy = buildOrderBy(query.sortBy, query.sortOrder, PAYOUT_SORT_FIELDS, 'createdAt');

    const result = await this.finance.listPayouts({
      page: query.page,
      limit: query.limit,
      orderBy,
      driverId,
      status: query.status,
      from: query.from,
      to: query.to,
    });

    return { items: result.items.map(toPayoutDto), meta: result.meta };
  }
}

@Injectable()
export class CancelPayoutUseCase {
  constructor(
    private readonly finance: RiderFinanceRepository,
    private readonly access: RiderAccessService,
  ) {}

  /** The rider withdraws their own request; the held money goes straight back. */
  async execute(payoutId: string, actor: AuthenticatedUser): Promise<PayoutRequestDto> {
    const rider = await this.access.mine(actor);
    const payout = await this.finance.findPayout(payoutId);

    if (!payout || payout.driverId !== rider.id) {
      throw new ResourceNotFoundException('Withdrawal request', payoutId);
    }

    if (payout.status !== PayoutStatus.PENDING) {
      throw new BusinessRuleViolationException(
        `This request is ${payout.status.toLowerCase()} and can no longer be cancelled.`,
      );
    }

    return toPayoutDto(
      await this.finance.refundPayout(payoutId, PayoutStatus.CANCELLED, {
        reviewerId: null,
        reason: 'Cancelled by the rider',
      }),
    );
  }
}

@Injectable()
export class ProcessPayoutUseCase {
  constructor(private readonly finance: RiderFinanceRepository) {}

  /**
   * Marks a request cleared for payment.
   *
   * Approval and payment are separate steps because they happen at different
   * times and by different hands: an operator approves, and the transfer is
   * made later against a bank batch. Collapsing them would record money as sent
   * before anyone had sent it.
   */
  async approve(payoutId: string, reviewer: AuthenticatedUser): Promise<PayoutRequestDto> {
    const payout = await this.load(payoutId);

    if (payout.status !== PayoutStatus.PENDING) {
      throw new BusinessRuleViolationException(
        `Only a pending request can be approved; this one is ${payout.status.toLowerCase()}.`,
      );
    }

    return toPayoutDto(await this.finance.approvePayout(payoutId, reviewer.id));
  }

  async markPaid(
    payoutId: string,
    dto: MarkPayoutPaidDto,
    reviewer: AuthenticatedUser,
  ): Promise<PayoutRequestDto> {
    const payout = await this.load(payoutId);

    if (payout.status !== PayoutStatus.APPROVED) {
      throw new BusinessRuleViolationException(
        `Approve this request before marking it paid; it is currently ${payout.status.toLowerCase()}.`,
      );
    }

    return toPayoutDto(
      await this.finance.markPayoutPaid(payoutId, reviewer.id, dto.paymentReference ?? null),
    );
  }

  /** Refuses the request and returns the held money to the rider's wallet. */
  async reject(
    payoutId: string,
    dto: RejectPayoutDto,
    reviewer: AuthenticatedUser,
  ): Promise<PayoutRequestDto> {
    const payout = await this.load(payoutId);

    if (payout.status !== PayoutStatus.PENDING && payout.status !== PayoutStatus.APPROVED) {
      throw new BusinessRuleViolationException(
        `This request is ${payout.status.toLowerCase()} and can no longer be rejected.`,
      );
    }

    return toPayoutDto(
      await this.finance.refundPayout(payoutId, PayoutStatus.REJECTED, {
        reviewerId: reviewer.id,
        reason: dto.reason,
      }),
    );
  }

  private async load(payoutId: string) {
    const payout = await this.finance.findPayout(payoutId);

    if (!payout) {
      throw new ResourceNotFoundException('Withdrawal request', payoutId);
    }

    return payout;
  }
}
