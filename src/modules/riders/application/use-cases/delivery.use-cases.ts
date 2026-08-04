import { Injectable } from '@nestjs/common';
import { AssignmentStatus, OrderStatus } from '@prisma/client';

import { BusinessRuleViolationException } from '@/common/exceptions/domain.exception';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import { AdvanceOrderUseCase } from '@/modules/orders/application/use-cases/order-lifecycle.use-cases';

import { AssignmentRepository } from '../../domain/repositories/assignment.repository';
import { DeliveryNotificationPort } from '../../domain/repositories/delivery-notification.port';
import { RiderFinanceRepository } from '../../domain/repositories/rider-finance.repository';
import { DeliveryOtpService, OTP_LENGTH } from '../../domain/services/delivery-otp.service';
import { EarningsCalculator } from '../../domain/services/earnings.calculator';
import {
  toAssignmentDto,
  type AssignmentDto,
  type DeliveryCodeIssuedDto,
  type DeliveryCompletedDto,
} from '../dto/rider-response.dto';
import type { ConfirmDeliveryDto } from '../dto/rider.dto';
import { RiderSettingsService } from '../services/rider-settings.service';
import { AssignmentAccessService } from './dispatch.use-cases';

@Injectable()
export class PickupOrderUseCase {
  constructor(
    private readonly assignments: AssignmentRepository,
    private readonly access: AssignmentAccessService,
    private readonly advance: AdvanceOrderUseCase,
    private readonly otp: DeliveryOtpService,
    private readonly notifications: DeliveryNotificationPort,
  ) {}

  /**
   * Collects the order from the restaurant and issues the delivery code.
   *
   * The code is generated here rather than at the door because this is the last
   * moment the customer can receive it calmly — by the time the rider is
   * outside, a notification that has not arrived is a rider standing in the
   * street. Only its hash is stored; the plaintext goes straight to the
   * customer and is not kept.
   */
  async execute(orderId: string, actor: AuthenticatedUser): Promise<DeliveryCodeIssuedDto> {
    const { assignment, rider } = await this.access.forOrder(orderId, actor);

    this.assertAccepted(assignment.status);

    await this.advance.execute(assignment.order.id, OrderStatus.PICKED_UP, actor);

    const code = this.otp.generate();

    await this.assignments.storeOtp(assignment.id, this.otp.hash(code, assignment.id), new Date());

    await this.notifications.sendDeliveryCode({
      customerId: assignment.order.customerId,
      orderId: assignment.order.id,
      orderNumber: assignment.order.orderNumber,
      code,
      riderName: rider.user.fullName,
    });

    return {
      message: 'Order collected. Ask the customer for their four-digit code at the door.',
      codeSent: true,
      codeLength: OTP_LENGTH,
    };
  }

  private assertAccepted(status: AssignmentStatus): void {
    if (status !== AssignmentStatus.ACCEPTED) {
      throw new BusinessRuleViolationException(
        status === AssignmentStatus.OFFERED
          ? 'Accept this delivery before collecting the order.'
          : `This delivery is ${status.toLowerCase()} and is no longer yours to collect.`,
      );
    }
  }
}

@Injectable()
export class StartDeliveryUseCase {
  constructor(
    private readonly access: AssignmentAccessService,
    private readonly advance: AdvanceOrderUseCase,
  ) {}

  /** Leaves the restaurant: PICKED_UP → ON_THE_WAY. */
  async execute(orderId: string, actor: AuthenticatedUser): Promise<{ message: string }> {
    const { assignment } = await this.access.forOrder(orderId, actor);

    await this.advance.execute(assignment.order.id, OrderStatus.ON_THE_WAY, actor);

    return { message: 'On the way. The customer can now follow your progress.' };
  }
}

@Injectable()
export class ConfirmDeliveryUseCase {
  constructor(
    private readonly assignments: AssignmentRepository,
    private readonly access: AssignmentAccessService,
    private readonly advance: AdvanceOrderUseCase,
    private readonly otp: DeliveryOtpService,
    private readonly finance: RiderFinanceRepository,
    private readonly earnings: EarningsCalculator,
    private readonly settings: RiderSettingsService,
  ) {}

  /**
   * Closes the delivery against the customer's code, then pays the rider.
   *
   * The code is what makes "delivered" mean something. Without it a rider can
   * mark an order complete from the end of the street, and the only party who
   * can dispute it is the customer who never got their food — after the fact,
   * against a record that says otherwise.
   *
   * Order first, money second: if the payout fails the delivery is still
   * recorded, and an unpaid earning is a support ticket rather than a customer
   * whose order is stuck ON_THE_WAY forever.
   */
  async execute(
    orderId: string,
    dto: ConfirmDeliveryDto,
    actor: AuthenticatedUser,
  ): Promise<DeliveryCompletedDto> {
    const { assignment, rider } = await this.access.forOrder(orderId, actor);

    if (assignment.status !== AssignmentStatus.ACCEPTED) {
      throw new BusinessRuleViolationException(
        `This delivery is ${assignment.status.toLowerCase()} and cannot be confirmed.`,
      );
    }

    try {
      this.otp.verify(
        dto.code,
        {
          hash: assignment.otpHash,
          issuedAt: assignment.otpIssuedAt,
          attempts: assignment.otpAttempts,
          verifiedAt: assignment.otpVerifiedAt,
        },
        assignment.id,
      );
    } catch (error) {
      // The attempt is counted even though the request failed — an uncounted
      // wrong guess is an unlimited one, which is the whole attack.
      await this.assignments.recordOtpFailure(assignment.id);
      throw error;
    }

    await this.advance.execute(assignment.order.id, OrderStatus.DELIVERED, actor, {
      otpVerified: true,
    });

    await this.assignments.complete(assignment.id);

    const rates = await this.settings.earningRates();
    const breakdown = this.earnings.calculate(
      {
        distanceKm:
          assignment.order.distanceKm === null ? null : Number(assignment.order.distanceKm),
        tipAmount: Number(assignment.order.tipAmount),
      },
      rates,
    );

    const credited = await this.finance.creditDeliveryEarnings({
      driverId: rider.id,
      userId: rider.userId,
      orderId: assignment.order.id,
      orderNumber: assignment.order.orderNumber,
      assignmentId: assignment.id,
      components: breakdown.components,
      total: breakdown.total,
    });

    const earnedAt = new Date();

    return {
      message: `Delivery confirmed. Rs. ${credited} has been added to your wallet.`,
      earned: credited,
      // Echoed straight from the calculation rather than re-read from the
      // ledger: the rider is standing on the doorstep waiting for this screen,
      // and the rows that were just written say exactly the same thing.
      breakdown: breakdown.components.map((component, index) => ({
        id: `${assignment.id}-${index}`,
        type: component.type,
        amount: component.amount,
        description: component.description,
        orderId: assignment.order.id,
        orderNumber: assignment.order.orderNumber,
        earnedAt,
      })),
    };
  }
}

@Injectable()
export class GetActiveDeliveryUseCase {
  constructor(private readonly access: AssignmentAccessService) {}

  /**
   * The delivery the rider is carrying right now.
   *
   * The rider's app opens on this screen, so it answers with the whole
   * assignment — addresses, contact details, what to collect — rather than
   * making a phone on a mobile connection assemble it from three calls.
   */
  async execute(orderId: string, actor: AuthenticatedUser): Promise<AssignmentDto> {
    const { assignment } = await this.access.forOrder(orderId, actor);

    return toAssignmentDto(assignment, { revealCustomer: true });
  }
}
