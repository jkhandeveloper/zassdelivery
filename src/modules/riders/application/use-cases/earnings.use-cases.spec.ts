import { PayoutMethod, PayoutStatus, UserRole } from '@prisma/client';

import {
  BusinessRuleViolationException,
  ForbiddenOperationException,
  ResourceNotFoundException,
} from '@/common/exceptions/domain.exception';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';

import type {
  RiderFinanceRepository,
  WalletSnapshot,
} from '../../domain/repositories/rider-finance.repository';
import type { RiderWithDetails } from '../../domain/repositories/rider.repository';
import type { RiderSettingsService } from '../services/rider-settings.service';
import {
  CancelPayoutUseCase,
  GetRiderWalletUseCase,
  ProcessPayoutUseCase,
  RequestPayoutUseCase,
} from './earnings.use-cases';
import type { RiderAccessService } from './rider-profile.use-cases';

const RIDER: AuthenticatedUser = {
  id: 'user-1',
  phone: '+923005551234',
  role: UserRole.RIDER,
  permissions: [],
  sessionId: 'session-1',
};

const REVIEWER: AuthenticatedUser = {
  id: 'admin-1',
  phone: '+923000000001',
  role: UserRole.ADMIN,
  permissions: ['payouts.approve'],
  sessionId: 'session-2',
};

function riderProfile(overrides: Partial<RiderWithDetails> = {}): RiderWithDetails {
  return {
    id: 'rider-1',
    userId: 'user-1',
    payoutBankName: 'Meezan Bank',
    payoutAccountTitle: 'Bilal Ahmed',
    payoutAccountNumber: '01234567890',
    ...overrides,
  } as unknown as RiderWithDetails;
}

function payout(overrides: Record<string, unknown> = {}) {
  return {
    id: 'payout-1',
    reference: 'WDR-260809-0001',
    driverId: 'rider-1',
    amount: 2500,
    method: PayoutMethod.BANK_TRANSFER,
    status: PayoutStatus.PENDING,
    bankName: 'Meezan Bank',
    accountTitle: 'Bilal Ahmed',
    accountNumber: '01234567890',
    rejectionReason: null,
    paymentReference: null,
    processedAt: null,
    createdAt: new Date(),
    ...overrides,
  } as never;
}

function build(options: {
  rider?: RiderWithDetails;
  wallet?: Partial<WalletSnapshot>;
  hasOpenPayout?: boolean;
  loadedPayout?: unknown;
}) {
  const access = {
    mine: jest.fn().mockResolvedValue(options.rider ?? riderProfile()),
  } as unknown as jest.Mocked<RiderAccessService>;

  const finance = {
    walletFor: jest.fn().mockResolvedValue({
      balance: 5000,
      currency: 'PKR',
      isLocked: false,
      pendingWithdrawals: 0,
      ...options.wallet,
    }),
    hasOpenPayout: jest.fn().mockResolvedValue(options.hasOpenPayout ?? false),
    requestPayout: jest
      .fn()
      .mockImplementation((input: { amount: number }) =>
        Promise.resolve(payout({ amount: input.amount })),
      ),
    findPayout: jest
      .fn()
      .mockResolvedValue('loadedPayout' in options ? options.loadedPayout : payout()),
    refundPayout: jest
      .fn()
      .mockImplementation((_id, status) => Promise.resolve(payout({ status }))),
    approvePayout: jest.fn().mockResolvedValue(payout({ status: PayoutStatus.APPROVED })),
    markPayoutPaid: jest.fn().mockResolvedValue(payout({ status: PayoutStatus.PAID })),
  } as unknown as jest.Mocked<RiderFinanceRepository>;

  const settings = {
    minimumWithdrawal: jest.fn().mockResolvedValue(500),
  } as unknown as jest.Mocked<RiderSettingsService>;

  return { access, finance, settings };
}

describe('RequestPayoutUseCase', () => {
  const request = { amount: 2500, method: PayoutMethod.BANK_TRANSFER };

  it('creates the request and holds the amount out of the wallet', async () => {
    const { access, finance, settings } = build({});
    const useCase = new RequestPayoutUseCase(finance, access, settings);

    const result = await useCase.execute(RIDER, request);

    expect(finance.requestPayout).toHaveBeenCalledWith(
      expect.objectContaining({ driverId: 'rider-1', userId: 'user-1', amount: 2500 }),
    );
    expect(result.status).toBe(PayoutStatus.PENDING);
  });

  it('masks the account number in the response', async () => {
    const { access, finance, settings } = build({});
    const useCase = new RequestPayoutUseCase(finance, access, settings);

    const result = await useCase.execute(RIDER, request);

    expect(result.accountNumber).toBe('•••••••7890');
  });

  it('refuses when the rider has no payout account on file', async () => {
    const { access, finance, settings } = build({
      rider: riderProfile({ payoutAccountNumber: null, payoutAccountTitle: null }),
    });
    const useCase = new RequestPayoutUseCase(finance, access, settings);

    await expect(useCase.execute(RIDER, request)).rejects.toThrow(/payout account details/);
    expect(finance.requestPayout).not.toHaveBeenCalled();
  });

  it('refuses a second request while one is still in flight', async () => {
    const { access, finance, settings } = build({ hasOpenPayout: true });
    const useCase = new RequestPayoutUseCase(finance, access, settings);

    await expect(useCase.execute(RIDER, request)).rejects.toThrow(/already have a withdrawal/);
  });

  it('refuses an amount below the platform minimum', async () => {
    const { access, finance, settings } = build({});
    const useCase = new RequestPayoutUseCase(finance, access, settings);

    await expect(useCase.execute(RIDER, { ...request, amount: 100 })).rejects.toThrow(
      /smallest withdrawal is Rs. 500/,
    );
  });

  it('refuses more than the wallet holds', async () => {
    const { access, finance, settings } = build({ wallet: { balance: 900 } });
    const useCase = new RequestPayoutUseCase(finance, access, settings);

    await expect(useCase.execute(RIDER, request)).rejects.toThrow(BusinessRuleViolationException);
    expect(finance.requestPayout).not.toHaveBeenCalled();
  });

  it('refuses when the wallet is locked', async () => {
    const { access, finance, settings } = build({ wallet: { isLocked: true } });
    const useCase = new RequestPayoutUseCase(finance, access, settings);

    await expect(useCase.execute(RIDER, request)).rejects.toThrow(ForbiddenOperationException);
  });
});

describe('GetRiderWalletUseCase', () => {
  it('reports money held for withdrawals separately from the balance', async () => {
    const { access, finance } = build({ wallet: { balance: 2320.5, pendingWithdrawals: 2500 } });
    const useCase = new GetRiderWalletUseCase(finance, access);

    const wallet = await useCase.execute(RIDER);

    expect(wallet.balance).toBe(2320.5);
    expect(wallet.pendingWithdrawals).toBe(2500);
    expect(wallet.availableToWithdraw).toBe(2320.5);
  });

  it('offers nothing to withdraw from a locked wallet', async () => {
    const { access, finance } = build({ wallet: { balance: 5000, isLocked: true } });
    const useCase = new GetRiderWalletUseCase(finance, access);

    await expect(useCase.execute(RIDER)).resolves.toMatchObject({ availableToWithdraw: 0 });
  });
});

describe('CancelPayoutUseCase', () => {
  it('cancels a pending request and returns the money', async () => {
    const { access, finance } = build({});
    const useCase = new CancelPayoutUseCase(finance, access);

    const result = await useCase.execute('payout-1', RIDER);

    expect(finance.refundPayout).toHaveBeenCalledWith('payout-1', PayoutStatus.CANCELLED, {
      reviewerId: null,
      reason: 'Cancelled by the rider',
    });
    expect(result.status).toBe(PayoutStatus.CANCELLED);
  });

  it('refuses to cancel a request that has already been paid', async () => {
    const { access, finance } = build({ loadedPayout: payout({ status: PayoutStatus.PAID }) });
    const useCase = new CancelPayoutUseCase(finance, access);

    await expect(useCase.execute('payout-1', RIDER)).rejects.toThrow(/can no longer be cancelled/);
  });

  it('will not let one rider cancel another rider’s request', async () => {
    const { access, finance } = build({ loadedPayout: payout({ driverId: 'someone-else' }) });
    const useCase = new CancelPayoutUseCase(finance, access);

    await expect(useCase.execute('payout-1', RIDER)).rejects.toThrow(ResourceNotFoundException);
    expect(finance.refundPayout).not.toHaveBeenCalled();
  });
});

describe('ProcessPayoutUseCase', () => {
  it('approves a pending request', async () => {
    const { finance } = build({});
    const useCase = new ProcessPayoutUseCase(finance);

    await expect(useCase.approve('payout-1', REVIEWER)).resolves.toMatchObject({
      status: PayoutStatus.APPROVED,
    });
  });

  it('refuses to approve a request that is not pending', async () => {
    const { finance } = build({ loadedPayout: payout({ status: PayoutStatus.REJECTED }) });
    const useCase = new ProcessPayoutUseCase(finance);

    await expect(useCase.approve('payout-1', REVIEWER)).rejects.toThrow(
      /Only a pending request can be approved/,
    );
  });

  it('will not mark a request paid before it has been approved', async () => {
    const { finance } = build({});
    const useCase = new ProcessPayoutUseCase(finance);

    await expect(useCase.markPaid('payout-1', {}, REVIEWER)).rejects.toThrow(
      /Approve this request before marking it paid/,
    );
    expect(finance.markPayoutPaid).not.toHaveBeenCalled();
  });

  it('records the bank reference when marking an approved request paid', async () => {
    const { finance } = build({ loadedPayout: payout({ status: PayoutStatus.APPROVED }) });
    const useCase = new ProcessPayoutUseCase(finance);

    await useCase.markPaid('payout-1', { paymentReference: 'IBFT-99881234' }, REVIEWER);

    expect(finance.markPayoutPaid).toHaveBeenCalledWith('payout-1', REVIEWER.id, 'IBFT-99881234');
  });

  it('returns the held money when a request is rejected', async () => {
    const { finance } = build({});
    const useCase = new ProcessPayoutUseCase(finance);

    await useCase.reject('payout-1', { reason: 'Account title does not match.' }, REVIEWER);

    expect(finance.refundPayout).toHaveBeenCalledWith('payout-1', PayoutStatus.REJECTED, {
      reviewerId: REVIEWER.id,
      reason: 'Account title does not match.',
    });
  });

  it('refuses to reject a request that was already paid out', async () => {
    const { finance } = build({ loadedPayout: payout({ status: PayoutStatus.PAID }) });
    const useCase = new ProcessPayoutUseCase(finance);

    await expect(
      useCase.reject('payout-1', { reason: 'Too late for this one.' }, REVIEWER),
    ).rejects.toThrow(/can no longer be rejected/);
  });

  it('reports an unknown request as not found', async () => {
    const { finance } = build({ loadedPayout: null });
    const useCase = new ProcessPayoutUseCase(finance);

    await expect(useCase.approve('missing', REVIEWER)).rejects.toThrow(ResourceNotFoundException);
  });
});
