import { Injectable } from '@nestjs/common';
import { PaymentStatus } from '@prisma/client';

import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';

import { PaymentRepository } from '../../domain/repositories/payment.repository';
import { toPaymentDto, type PaymentDto } from '../dto/payment-response.dto';
import type { FailPaymentDto } from '../dto/payment.dto';
import { PaymentAccessService } from './checkout.use-cases';

@Injectable()
export class FailPaymentAdminUseCase {
  constructor(
    private readonly payments: PaymentRepository,
    private readonly access: PaymentAccessService,
  ) {}

  /**
   * Writes off an attempt that will never complete.
   *
   * The order fails with it, which releases the stock the checkout was holding.
   * A payment that has already collected money cannot come through here — the
   * repository refuses it, and the answer is a refund, so the money leaves a
   * trail instead of quietly ceasing to exist.
   */
  async execute(
    paymentId: string,
    dto: FailPaymentDto,
    actor: AuthenticatedUser,
  ): Promise<PaymentDto> {
    const payment = await this.access.load(paymentId);

    const failed = await this.payments.fail({
      paymentId: payment.id,
      reason: dto.reason,
      gatewayResponse: { failedBy: actor.id, reason: dto.reason },
      status: PaymentStatus.FAILED,
      failOrder: true,
    });

    return toPaymentDto(failed);
  }
}
