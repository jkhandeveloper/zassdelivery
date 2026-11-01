import { SubscriptionInvoiceStatus } from '@prisma/client';

import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import type { NotifyService } from '@/modules/notifications/application/use-cases/notify.service';

import type {
  BillingRepository,
  InvoiceWithContext,
} from '../../domain/repositories/billing.repository';
import { BILLING_CYCLE_DAYS, addDays } from '../../domain/services/billing-schedule';
import {
  ConfirmTransferUseCase,
  RecordPaymentUseCase,
  VoidInvoiceUseCase,
} from './billing-admin.use-cases';

const NOW = new Date('2026-02-01T09:00:00.000Z');
const actor = { id: 'admin-1' } as AuthenticatedUser;

function invoiceFrom(periodStart: Date): InvoiceWithContext {
  return {
    id: 'invoice-1',
    invoiceNumber: 'SUB-260115-0001',
    status: SubscriptionInvoiceStatus.PENDING_REVIEW,
    amount: 1000,
    currency: 'PKR',
    periodStart,
    periodEnd: addDays(periodStart, BILLING_CYCLE_DAYS),
    dueAt: periodStart,
    blockAt: addDays(periodStart, 3),
    restaurantId: 'restaurant-1',
    restaurant: { id: 'restaurant-1', name: 'Karahi House', slug: 'karahi-house' },
    subscription: { ownerId: 'owner-1', owner: { id: 'owner-1' } },
  } as unknown as InvoiceWithContext;
}

describe('renewing a subscription', () => {
  let billing: jest.Mocked<
    Pick<BillingRepository, 'findInvoiceById' | 'confirmInvoice' | 'voidInvoice'>
  >;
  let notify: jest.Mocked<Pick<NotifyService, 'notify'>>;

  const useCases = () => ({
    confirm: new ConfirmTransferUseCase(
      billing as unknown as BillingRepository,
      notify as unknown as NotifyService,
    ),
    record: new RecordPaymentUseCase(
      billing as unknown as BillingRepository,
      notify as unknown as NotifyService,
    ),
    waive: new VoidInvoiceUseCase(
      billing as unknown as BillingRepository,
      notify as unknown as NotifyService,
    ),
  });

  beforeEach(() => {
    jest.useFakeTimers({ now: NOW });

    billing = {
      findInvoiceById: jest.fn(),
      confirmInvoice: jest.fn().mockResolvedValue(invoiceFrom(NOW)),
      voidInvoice: jest.fn().mockResolvedValue(invoiceFrom(NOW)),
    };
    notify = { notify: jest.fn() };
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('gives a vendor renewing 15 days late a full month from today', async () => {
    billing.findInvoiceById.mockResolvedValue(invoiceFrom(addDays(NOW, -15)));

    await useCases().confirm.execute('invoice-1', actor);

    expect(billing.confirmInvoice).toHaveBeenCalledWith(
      expect.objectContaining({
        nextPeriodStart: NOW,
        nextPeriodEnd: addDays(NOW, BILLING_CYCLE_DAYS),
      }),
    );
    expect(notify.notify.mock.calls[0]?.[0].body).toContain('3 March 2026');
  });

  it('does not take days from a vendor renewing before the period ends', async () => {
    const dueAt = addDays(NOW, 5);
    billing.findInvoiceById.mockResolvedValue(invoiceFrom(dueAt));

    await useCases().confirm.execute('invoice-1', actor);

    expect(billing.confirmInvoice).toHaveBeenCalledWith(
      expect.objectContaining({
        nextPeriodStart: dueAt,
        nextPeriodEnd: addDays(dueAt, BILLING_CYCLE_DAYS),
      }),
    );
  });

  it('starts the month at the recording, not the date the money arrived', async () => {
    billing.findInvoiceById.mockResolvedValue(invoiceFrom(addDays(NOW, -15)));

    await useCases().record.execute(
      'invoice-1',
      { channel: 'BANK', paidAt: addDays(NOW, -10) } as never,
      actor,
    );

    expect(billing.confirmInvoice).toHaveBeenCalledWith(
      expect.objectContaining({
        nextPeriodStart: NOW,
        nextPeriodEnd: addDays(NOW, BILLING_CYCLE_DAYS),
        paidAt: addDays(NOW, -10),
      }),
    );
  });

  it('gives a waived vendor a full month from today too', async () => {
    billing.findInvoiceById.mockResolvedValue(invoiceFrom(addDays(NOW, -15)));

    await useCases().waive.execute('invoice-1', { reason: 'Goodwill' }, actor);

    expect(billing.voidInvoice).toHaveBeenCalledWith('invoice-1', 'Goodwill', actor.id, {
      start: NOW,
      end: addDays(NOW, BILLING_CYCLE_DAYS),
    });
  });
});
