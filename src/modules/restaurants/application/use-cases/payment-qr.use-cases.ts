import { Injectable } from '@nestjs/common';
import { UserRole } from '@prisma/client';

import {
  toPaymentQrCodes,
  toStoredPaymentQrCodes,
  type PaymentQrCodeDto,
  type SetPaymentQrCodesDto,
} from '@/common/dto/payment-qr-code.dto';
import {
  ForbiddenOperationException,
  ResourceNotFoundException,
} from '@/common/exceptions/domain.exception';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';

import { RestaurantRepository } from '../../domain/repositories/restaurant.repository';
import { assertCanManage } from './restaurants.use-cases';

@Injectable()
export class SetRestaurantPaymentQrCodesUseCase {
  constructor(private readonly restaurants: RestaurantRepository) {}

  /**
   * Replaces where scan-to-pay customers send their money.
   *
   * Owner-only, unlike the rest of the listing: kitchen staff may edit the menu
   * and the profile, but a staff member who could swap in their own QR would be
   * quietly collecting the restaurant's takings.
   */
  async execute(
    id: string,
    dto: SetPaymentQrCodesDto,
    actor: AuthenticatedUser,
  ): Promise<PaymentQrCodeDto[]> {
    const existing = await this.restaurants.findById(id);

    if (!existing) {
      throw new ResourceNotFoundException('Restaurant', id);
    }

    assertCanManage(existing, actor);

    if (actor.role === UserRole.VENDOR_STAFF) {
      throw new ForbiddenOperationException(
        'Only the owner can change where customers send payments.',
      );
    }

    const updated = await this.restaurants.setPaymentQrCodes(id, toStoredPaymentQrCodes(dto.codes));

    return toPaymentQrCodes(updated.paymentQrCodes);
  }
}
