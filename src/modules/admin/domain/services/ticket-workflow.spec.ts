import { TicketStatus } from '@prisma/client';

import { TicketWorkflow } from './ticket-workflow';

describe('TicketWorkflow.assertTransition', () => {
  it('lets an open ticket be picked up', () => {
    expect(() =>
      TicketWorkflow.assertTransition(TicketStatus.OPEN, TicketStatus.IN_PROGRESS),
    ).not.toThrow();
  });

  it('lets a resolved ticket be reopened', () => {
    // "That did not fix it" is the most common thing to happen to one.
    expect(() =>
      TicketWorkflow.assertTransition(TicketStatus.RESOLVED, TicketStatus.IN_PROGRESS),
    ).not.toThrow();
  });

  it('refuses to reopen a closed ticket', () => {
    // Closing is the deliberate end; a queue you can never empty is not a queue.
    expect(() =>
      TicketWorkflow.assertTransition(TicketStatus.CLOSED, TicketStatus.IN_PROGRESS),
    ).toThrow(/cannot move from CLOSED/);
  });

  it('refuses a move to the status already held', () => {
    expect(() => TicketWorkflow.assertTransition(TicketStatus.OPEN, TicketStatus.OPEN)).toThrow(
      /already open/,
    );
  });

  it('lets a ticket be closed from anywhere that is not already closed', () => {
    for (const from of [
      TicketStatus.OPEN,
      TicketStatus.IN_PROGRESS,
      TicketStatus.WAITING_ON_CUSTOMER,
      TicketStatus.RESOLVED,
    ]) {
      expect(() => TicketWorkflow.assertTransition(from, TicketStatus.CLOSED)).not.toThrow();
    }
  });

  it('names the legal alternatives when refusing', () => {
    expect(() => TicketWorkflow.assertTransition(TicketStatus.RESOLVED, TicketStatus.OPEN)).toThrow(
      /Allowed: IN_PROGRESS, CLOSED/,
    );
  });
});

describe('TicketWorkflow.isOpen', () => {
  it('counts anything still awaiting somebody', () => {
    expect(TicketWorkflow.isOpen(TicketStatus.OPEN)).toBe(true);
    expect(TicketWorkflow.isOpen(TicketStatus.IN_PROGRESS)).toBe(true);
    expect(TicketWorkflow.isOpen(TicketStatus.WAITING_ON_CUSTOMER)).toBe(true);
  });

  it('does not count finished ones', () => {
    expect(TicketWorkflow.isOpen(TicketStatus.RESOLVED)).toBe(false);
    expect(TicketWorkflow.isOpen(TicketStatus.CLOSED)).toBe(false);
  });
});

describe('TicketWorkflow.customerMayReply', () => {
  it('lets a customer reply to anything that is not closed', () => {
    for (const status of [
      TicketStatus.OPEN,
      TicketStatus.IN_PROGRESS,
      TicketStatus.WAITING_ON_CUSTOMER,
      TicketStatus.RESOLVED,
    ]) {
      expect(TicketWorkflow.customerMayReply(status)).toBe(true);
    }
  });

  it('stops at a closed ticket', () => {
    expect(TicketWorkflow.customerMayReply(TicketStatus.CLOSED)).toBe(false);
  });
});

describe('TicketWorkflow.statusAfterCustomerReply', () => {
  it('puts a waiting ticket back in the queue — the reply is what was awaited', () => {
    expect(TicketWorkflow.statusAfterCustomerReply(TicketStatus.WAITING_ON_CUSTOMER)).toBe(
      TicketStatus.IN_PROGRESS,
    );
  });

  it('reopens a resolved ticket rather than leaving a complaint marked done', () => {
    expect(TicketWorkflow.statusAfterCustomerReply(TicketStatus.RESOLVED)).toBe(
      TicketStatus.IN_PROGRESS,
    );
  });

  it('leaves an open ticket where it is', () => {
    expect(TicketWorkflow.statusAfterCustomerReply(TicketStatus.OPEN)).toBe(TicketStatus.OPEN);
  });

  it('leaves a ticket already in progress alone', () => {
    expect(TicketWorkflow.statusAfterCustomerReply(TicketStatus.IN_PROGRESS)).toBe(
      TicketStatus.IN_PROGRESS,
    );
  });
});
