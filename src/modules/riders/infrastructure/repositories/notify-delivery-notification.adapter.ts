import { Injectable } from '@nestjs/common';
import { NotificationChannel, NotificationType } from '@prisma/client';

import { NotifyService } from '@/modules/notifications/application/use-cases/notify.service';

import { DeliveryNotificationPort } from '../../domain/repositories/delivery-notification.port';

/**
 * Delivery updates, sent through the platform's one notification path.
 *
 * The port stays because the delivery flow should not care how a message
 * travels; what changed underneath is that it now goes through `NotifyService`
 * rather than writing notification rows directly — so these reach a phone as a
 * push, honour the customer's preferences, and appear in their history like
 * everything else.
 */
@Injectable()
export class NotifyDeliveryNotificationAdapter extends DeliveryNotificationPort {
  constructor(private readonly notify: NotifyService) {
    super();
  }

  async sendDeliveryCode(input: {
    customerId: string;
    orderId: string;
    orderNumber: string;
    code: string;
    riderName: string;
  }): Promise<void> {
    await this.notify.notify({
      userId: input.customerId,
      type: NotificationType.ORDER_UPDATE,
      title: `Your delivery code is ${input.code}`,
      body:
        `${input.riderName} has collected order ${input.orderNumber}. ` +
        `Give them the code ${input.code} when your order arrives — it is how we ` +
        'confirm the delivery reached you.',
      // The code travels in the payload as well as the body so the app can
      // render it as a card rather than asking the customer to read it out of a
      // sentence.
      data: { orderId: input.orderId, code: input.code, kind: 'delivery_code' },
      // Deliberately not narrowed to in-app: a code that only appears in a list
      // the customer has to go and open is a code the rider waits for.
      channels: [NotificationChannel.IN_APP, NotificationChannel.PUSH],
    });
  }

  async sendRiderAssigned(input: {
    customerId: string;
    orderId: string;
    orderNumber: string;
    riderName: string;
    riderPhone: string;
  }): Promise<void> {
    await this.notify.notify({
      userId: input.customerId,
      type: NotificationType.ORDER_UPDATE,
      title: `${input.riderName} is bringing your order`,
      body: `${input.riderName} has accepted order ${input.orderNumber} and is heading to the restaurant.`,
      data: {
        orderId: input.orderId,
        riderName: input.riderName,
        riderPhone: input.riderPhone,
        kind: 'rider_assigned',
      },
    });
  }
}
