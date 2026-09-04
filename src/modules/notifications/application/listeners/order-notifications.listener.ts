import { Inject, Injectable, type LoggerService } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { NotificationChannel, NotificationType, OrderStatus } from '@prisma/client';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';

import {
  OrderEvents,
  type OrderStatusEventPayload,
} from '@/modules/orders/domain/events/order.events';

import { NotifyService } from '../use-cases/notify.service';

/** One message, addressed to one of the three people an order involves. */
interface Message {
  userId: string;
  title: string;
  body: string;
  /** Urgent enough to wake a phone rather than wait to be looked at. */
  push?: boolean;
}

/**
 * Turns order transitions into messages people actually receive.
 *
 * Until now the only notifications an order produced were the delivery code and
 * the rider's name, both to the customer and both after a rider had already
 * accepted — so a customer who placed an order and a vendor who received one
 * were told nothing at all, and the notifications screen was empty for exactly
 * the events it exists for.
 *
 * A listener rather than calls scattered through the order use cases: the
 * orders module should not have to know that notifications exist, and keeping
 * every order message in one file is what makes the set reviewable as a whole —
 * which matters, because the failure mode here is not a crash but a customer
 * being told the same thing twice or not at all.
 */
@Injectable()
export class OrderNotificationsListener {
  private readonly context = OrderNotificationsListener.name;

  constructor(
    private readonly notify: NotifyService,
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: LoggerService,
  ) {}

  @OnEvent(OrderEvents.placed, { async: true })
  async onPlaced(event: OrderStatusEventPayload): Promise<void> {
    await this.send(event, [
      {
        userId: event.customerId,
        title: `Order ${event.orderNumber} is with ${event.restaurantName}`,
        body: 'We have sent it to the restaurant. You will hear from us as soon as they accept it.',
      },
      {
        userId: event.restaurantOwnerId,
        title: `New order ${event.orderNumber}`,
        body:
          `${event.totalAmount} PKR, waiting for you to accept it. ` +
          'Open the order queue to confirm or reject it.',
        // The one message in this file that is genuinely time-critical on the
        // vendor side: the customer is watching a clock until they accept.
        push: true,
      },
    ]);
  }

  @OnEvent(OrderEvents.statusChanged, { async: true })
  async onStatusChanged(event: OrderStatusEventPayload): Promise<void> {
    await this.send(event, this.messagesFor(event));
  }

  /**
   * Who hears about a transition, and what they are told.
   *
   * Deliberately not every status. PICKED_UP and ON_THE_WAY already reach the
   * customer as the delivery code and the rider's name from the riders module,
   * and a second message saying the same thing in weaker words is how a
   * notification list becomes something people mute.
   */
  private messagesFor(event: OrderStatusEventPayload): Message[] {
    switch (event.status) {
      case OrderStatus.CONFIRMED:
        return [
          {
            userId: event.customerId,
            title: `${event.restaurantName} accepted your order`,
            body: `Order ${event.orderNumber} is confirmed and will start cooking shortly.`,
          },
        ];

      case OrderStatus.READY_FOR_PICKUP:
        return [
          {
            userId: event.customerId,
            title: `Order ${event.orderNumber} is ready`,
            body: 'Your food is packed and waiting for a rider to collect it.',
          },
        ];

      // PICKED_UP is left alone on purpose — the riders module already sends the
      // delivery code at that moment, and two messages a second apart is how a
      // notification list becomes something people mute. ON_THE_WAY is the one
      // that earns its place: it is the point at which the map starts moving,
      // and the customer has no other way to learn that.
      case OrderStatus.ON_THE_WAY:
        return [
          {
            userId: event.customerId,
            title: `Your rider is on the way`,
            body: `Order ${event.orderNumber} has left ${event.restaurantName}. Follow them on the map and have your four-digit code ready.`,
            push: true,
          },
        ];

      case OrderStatus.DELIVERED:
        return [
          {
            userId: event.customerId,
            title: `Order ${event.orderNumber} delivered`,
            body: `Enjoy your food. Tell us how ${event.restaurantName} did — it helps other people order.`,
          },
        ];

      case OrderStatus.REJECTED:
        return [
          {
            userId: event.customerId,
            title: `${event.restaurantName} could not take your order`,
            body: `Order ${event.orderNumber} was rejected and anything you paid is being returned to your wallet.`,
            push: true,
          },
        ];

      case OrderStatus.CANCELLED:
      case OrderStatus.FAILED:
        return this.cancellation(event);

      default:
        return [];
    }
  }

  /**
   * A cancellation is told to everyone left holding the order — except whoever
   * did it, who does not need to be informed of their own decision.
   */
  private cancellation(event: OrderStatusEventPayload): Message[] {
    const ended = event.status === OrderStatus.CANCELLED ? 'cancelled' : 'could not be delivered';

    const messages: Message[] = [
      {
        userId: event.customerId,
        title: `Order ${event.orderNumber} ${ended}`,
        body: `Your order with ${event.restaurantName} ${ended}. Anything you paid goes back to your wallet.`,
        push: true,
      },
      {
        userId: event.restaurantOwnerId,
        title: `Order ${event.orderNumber} ${ended}`,
        body: 'Stop preparing it if you have started — it is no longer coming to a customer.',
        push: true,
      },
    ];

    if (event.driverUserId !== null) {
      messages.push({
        userId: event.driverUserId,
        title: `Order ${event.orderNumber} ${ended}`,
        body: 'This run is off. You are free for the next offer.',
        push: true,
      });
    }

    return messages;
  }

  /**
   * Sends the batch, and lets nothing in it break anything else.
   *
   * Each message is settled independently: a vendor with a dead device token
   * must not cost the customer their notification, and neither of them may
   * surface as an error on an order that has already been committed.
   */
  private async send(event: OrderStatusEventPayload, messages: Message[]): Promise<void> {
    if (messages.length === 0) {
      return;
    }

    const results = await Promise.allSettled(
      messages.map((message) =>
        this.notify.notify({
          userId: message.userId,
          type: NotificationType.ORDER_UPDATE,
          title: message.title,
          body: message.body,
          data: {
            orderId: event.orderId,
            orderNumber: event.orderNumber,
            status: event.status,
            kind: 'order_update',
          },
          channels:
            message.push === true
              ? [NotificationChannel.IN_APP, NotificationChannel.PUSH]
              : undefined,
        }),
      ),
    );

    for (const result of results) {
      if (result.status === 'rejected') {
        this.logger.warn?.(
          `Order ${event.orderNumber}: a ${event.status} notification could not be sent: ` +
            `${(result.reason as Error).message}`,
          this.context,
        );
      }
    }
  }
}
