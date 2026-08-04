import { Injectable } from '@nestjs/common';
import { NotificationChannel, NotificationType } from '@prisma/client';

import { PrismaService } from '@/infrastructure/prisma/prisma.service';

import { DeliveryNotificationPort } from '../../domain/repositories/delivery-notification.port';

/**
 * Delivers rider updates as in-app notifications.
 *
 * In-app only for now: SMS and push arrive with the notifications module, and
 * because the flow talks to a port rather than to this class, adding them will
 * not touch the delivery code at all.
 */
@Injectable()
export class PrismaDeliveryNotificationAdapter extends DeliveryNotificationPort {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async sendDeliveryCode(input: {
    customerId: string;
    orderId: string;
    orderNumber: string;
    code: string;
    riderName: string;
  }): Promise<void> {
    await this.prisma.notification.create({
      data: {
        userId: input.customerId,
        type: NotificationType.ORDER_UPDATE,
        channel: NotificationChannel.IN_APP,
        title: `Your delivery code is ${input.code}`,
        body:
          `${input.riderName} has collected order ${input.orderNumber}. ` +
          `Give them the code ${input.code} when your order arrives — it is how we ` +
          'confirm the delivery reached you.',
        // The code travels in the payload as well as the body so the app can
        // render it as a card rather than asking the customer to read it out of
        // a sentence.
        data: { orderId: input.orderId, code: input.code, kind: 'delivery_code' },
        sentAt: new Date(),
      },
    });
  }

  async sendRiderAssigned(input: {
    customerId: string;
    orderId: string;
    orderNumber: string;
    riderName: string;
    riderPhone: string;
  }): Promise<void> {
    await this.prisma.notification.create({
      data: {
        userId: input.customerId,
        type: NotificationType.ORDER_UPDATE,
        channel: NotificationChannel.IN_APP,
        title: `${input.riderName} is bringing your order`,
        body: `${input.riderName} has accepted order ${input.orderNumber} and is heading to the restaurant.`,
        data: {
          orderId: input.orderId,
          riderName: input.riderName,
          riderPhone: input.riderPhone,
          kind: 'rider_assigned',
        },
        sentAt: new Date(),
      },
    });
  }
}
