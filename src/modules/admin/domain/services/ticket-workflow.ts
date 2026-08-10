import { TicketStatus } from '@prisma/client';

import { BusinessRuleViolationException } from '@/common/exceptions/domain.exception';

/**
 * The support ticket lifecycle, declared as data.
 *
 * The shape that matters: a resolved ticket can be reopened, because a customer
 * saying "that did not fix it" is the most common thing that happens to one. A
 * closed ticket cannot — closing is the deliberate end, and a thread that can
 * come back from it is a queue nobody can ever empty.
 */
export const TICKET_TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  [TicketStatus.OPEN]: [
    TicketStatus.IN_PROGRESS,
    TicketStatus.WAITING_ON_CUSTOMER,
    TicketStatus.RESOLVED,
    TicketStatus.CLOSED,
  ],
  [TicketStatus.IN_PROGRESS]: [
    TicketStatus.WAITING_ON_CUSTOMER,
    TicketStatus.RESOLVED,
    TicketStatus.CLOSED,
  ],
  [TicketStatus.WAITING_ON_CUSTOMER]: [
    TicketStatus.IN_PROGRESS,
    TicketStatus.RESOLVED,
    TicketStatus.CLOSED,
  ],
  // "That did not fix it" is the most common thing to happen to a resolved
  // ticket, so reopening is a first-class move rather than a new thread.
  [TicketStatus.RESOLVED]: [TicketStatus.IN_PROGRESS, TicketStatus.CLOSED],
  [TicketStatus.CLOSED]: [],
};

/** Statuses in which the ticket is still somebody's problem. */
export const OPEN_STATUSES: TicketStatus[] = [
  TicketStatus.OPEN,
  TicketStatus.IN_PROGRESS,
  TicketStatus.WAITING_ON_CUSTOMER,
];

export class TicketWorkflow {
  static assertTransition(from: TicketStatus, to: TicketStatus): void {
    if (from === to) {
      throw new BusinessRuleViolationException(
        `This ticket is already ${from.toLowerCase().replace(/_/g, ' ')}.`,
      );
    }

    const allowed = TICKET_TRANSITIONS[from];

    if (!allowed.includes(to)) {
      throw new BusinessRuleViolationException(
        `A ticket cannot move from ${from} to ${to}. Allowed: ${allowed.join(', ') || 'none'}.`,
      );
    }
  }

  static isOpen(status: TicketStatus): boolean {
    return OPEN_STATUSES.includes(status);
  }

  /**
   * Whether a customer may still add to the thread.
   *
   * A closed ticket is a dead end by design; a customer with more to say opens
   * a new one, which is also how the queue stays honest about its own size.
   */
  static customerMayReply(status: TicketStatus): boolean {
    return status !== TicketStatus.CLOSED;
  }

  /** The status a ticket lands in when a customer replies. */
  static statusAfterCustomerReply(current: TicketStatus): TicketStatus {
    // A reply to "waiting on customer" is the thing that was being waited for,
    // so it goes back into the queue rather than sitting there answered.
    return current === TicketStatus.WAITING_ON_CUSTOMER || current === TicketStatus.RESOLVED
      ? TicketStatus.IN_PROGRESS
      : current;
  }
}
