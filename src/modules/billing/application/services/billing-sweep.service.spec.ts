import type { SchedulerRegistry } from '@nestjs/schedule';

import type { NotifyService } from '@/modules/notifications/application/use-cases/notify.service';

import type {
  BillingRepository,
  InvoiceWithContext,
} from '../../domain/repositories/billing.repository';
import type { BillingPricingService } from './billing-pricing.service';
import { BillingSweepService } from './billing-sweep.service';

const OVERDUE = {
  id: 'invoice-1',
  subscriptionId: 'subscription-1',
  restaurantId: 'restaurant-1',
  invoiceNumber: 'SUB-261028-0024',
  currency: 'PKR',
  amount: 2000,
  restaurant: { name: 'AAAT' },
  subscription: { ownerId: 'owner-1' },
} as unknown as InvoiceWithContext;

const QR_CODE = { provider: 'JAZZCASH' };

function build({ payTo, toBlock }: { payTo: unknown[]; toBlock: InvoiceWithContext[] }) {
  const billing = {
    findActiveRestaurantsWithoutSubscription: jest.fn().mockResolvedValue([]),
    findSubscriptionsNeedingInvoice: jest.fn().mockResolvedValue([]),
    findInvoicesToRemind: jest.fn().mockResolvedValue([]),
    findInvoicesPastDue: jest.fn().mockResolvedValue([]),
    findInvoicesToBlock: jest.fn().mockResolvedValue(toBlock),
    suspendForNonPayment: jest.fn().mockResolvedValue(undefined),
  };
  const pricing = { payToQrCodes: jest.fn().mockResolvedValue(payTo) };
  const notify = { notify: jest.fn().mockResolvedValue(undefined) };
  const logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };

  const service = new BillingSweepService(
    billing as unknown as BillingRepository,
    pricing as unknown as BillingPricingService,
    notify as unknown as NotifyService,
    {} as SchedulerRegistry,
    { trialDays: 30, graceDays: 1, sweepCron: '0 * * * *' },
    logger,
  );

  return { service, billing, notify, logger };
}

describe('BillingSweepService', () => {
  describe('suspending unpaid vendors', () => {
    it('closes a vendor whose grace has run out', async () => {
      const { service, billing, notify, logger } = build({
        payTo: [QR_CODE],
        toBlock: [OVERDUE],
      });

      await service.sweep();

      expect(billing.suspendForNonPayment).toHaveBeenCalledWith('subscription-1');
      expect(notify.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'owner-1',
          body: expect.stringContaining("Pay it and we'll reopen you") as string,
        }),
      );
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it('still closes them when the platform has published no QR codes', async () => {
      const { service, billing, notify, logger } = build({ payTo: [], toBlock: [OVERDUE] });

      await service.sweep();

      expect(billing.suspendForNonPayment).toHaveBeenCalledWith('subscription-1');
      expect(notify.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.stringContaining('Contact support') as string,
        }),
      );
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('no payment QR codes'),
        BillingSweepService.name,
      );
    });

    it('says nothing about QR codes when nobody is due to close', async () => {
      const { service, billing, logger } = build({ payTo: [], toBlock: [] });

      await service.sweep();

      expect(billing.suspendForNonPayment).not.toHaveBeenCalled();
      expect(logger.warn).not.toHaveBeenCalled();
    });
  });
});
