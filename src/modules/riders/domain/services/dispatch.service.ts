import { Injectable } from '@nestjs/common';
import { AssignmentStatus } from '@prisma/client';

import { BusinessRuleViolationException } from '@/common/exceptions/domain.exception';
import { haversineKm } from '@/common/utils/geo.util';

/** A rider considered for a run, with everything ranking needs. */
export interface DispatchCandidate {
  driverId: string;
  zoneId: string | null;
  currentLat: number | null;
  currentLng: number | null;
  lastLocationAt: Date | null;
  rating: number;
  /** Assignments this rider has already turned down for this order. */
  hasRejectedThisOrder: boolean;
}

export interface RankedCandidate extends DispatchCandidate {
  /** Straight-line distance to the restaurant, or null with no known position. */
  pickupDistanceKm: number | null;
  score: number;
}

export interface DispatchOptions {
  /** How far from the restaurant a rider may be and still be offered the run. */
  searchRadiusKm: number;
  /** Positions older than this are treated as unknown. */
  locationFreshnessMinutes: number;
  /** The zone the order belongs to; riders based here are preferred. */
  orderZoneId: string;
}

/**
 * Terminal assignment states. Once an offer has been answered — or has run out
 * of time — it never changes again; a re-offer is a new row, which is what
 * makes the assignment table a truthful record of how an order was dispatched.
 */
export const TERMINAL_ASSIGNMENT_STATUSES: AssignmentStatus[] = [
  AssignmentStatus.REJECTED,
  AssignmentStatus.EXPIRED,
  AssignmentStatus.CANCELLED,
  AssignmentStatus.COMPLETED,
];

/**
 * Chooses which rider is offered a delivery.
 *
 * Deliberately a pure service with no repository of its own: dispatch policy is
 * the part most likely to be tuned once real riders are on the road, and
 * keeping it free of I/O means it can be reasoned about and tested on its own.
 */
@Injectable()
export class DispatchService {
  /**
   * Ranks candidates for a pickup, nearest first.
   *
   * Distance dominates because it is what the customer feels as waiting time.
   * Zone membership breaks near-ties in favour of a rider who knows the area,
   * and rating is the last tiebreak rather than a headline factor — dispatch
   * should not quietly starve a new rider of work before they have a record.
   */
  rank(
    candidates: DispatchCandidate[],
    pickupLat: number,
    pickupLng: number,
    options: DispatchOptions,
    now: Date = new Date(),
  ): RankedCandidate[] {
    const freshnessCutoff = new Date(now.getTime() - options.locationFreshnessMinutes * 60_000);

    return candidates
      .filter((candidate) => !candidate.hasRejectedThisOrder)
      .map((candidate) => {
        const hasFreshPosition =
          candidate.currentLat !== null &&
          candidate.currentLng !== null &&
          candidate.lastLocationAt !== null &&
          candidate.lastLocationAt >= freshnessCutoff;

        const pickupDistanceKm = hasFreshPosition
          ? haversineKm(
              candidate.currentLat as number,
              candidate.currentLng as number,
              pickupLat,
              pickupLng,
            )
          : null;

        return {
          ...candidate,
          pickupDistanceKm,
          score: this.score(candidate, pickupDistanceKm, options),
        };
      })
      .filter(
        (candidate) =>
          // A stale position is not a disqualification: a rider whose app has
          // not reported in for a few minutes is still in the zone and still
          // wants work. They simply rank below anyone we can actually locate.
          candidate.pickupDistanceKm === null ||
          candidate.pickupDistanceKm <= options.searchRadiusKm,
      )
      .sort((a, b) => b.score - a.score);
  }

  private score(
    candidate: DispatchCandidate,
    pickupDistanceKm: number | null,
    options: DispatchOptions,
  ): number {
    // Riders we cannot locate start from a deliberately poor proximity score,
    // so a rider with a known position always wins a straight comparison.
    const proximity =
      pickupDistanceKm === null
        ? 0
        : Math.max(0, 1 - pickupDistanceKm / Math.max(options.searchRadiusKm, 0.1));

    const zoneBonus = candidate.zoneId === options.orderZoneId ? 1 : 0;

    // Weights: proximity 60, home zone 25, rating 15 (of five stars).
    return proximity * 60 + zoneBonus * 25 + (candidate.rating / 5) * 15;
  }

  /** The single best rider for a run, or null when nobody is available. */
  pick(
    candidates: DispatchCandidate[],
    pickupLat: number,
    pickupLng: number,
    options: DispatchOptions,
    now: Date = new Date(),
  ): RankedCandidate | null {
    return this.rank(candidates, pickupLat, pickupLng, options, now)[0] ?? null;
  }

  /** Whether an offer is still open, i.e. neither answered nor timed out. */
  static isLive(status: AssignmentStatus, expiresAt: Date, now: Date = new Date()): boolean {
    return status === AssignmentStatus.OFFERED && expiresAt > now;
  }

  /**
   * Validates that an offer can still be answered.
   *
   * The expiry is checked here rather than trusted from the status column: a
   * sweep marks offers EXPIRED in the background, and a rider tapping "accept"
   * a second after the deadline must not win a race against it.
   */
  static assertAnswerable(status: AssignmentStatus, expiresAt: Date, now: Date = new Date()): void {
    if (status !== AssignmentStatus.OFFERED) {
      throw new BusinessRuleViolationException(
        status === AssignmentStatus.ACCEPTED
          ? 'You have already accepted this delivery.'
          : `This offer is ${status.toLowerCase()} and can no longer be answered.`,
      );
    }

    if (expiresAt <= now) {
      throw new BusinessRuleViolationException(
        'This offer has expired and has been passed to another rider.',
      );
    }
  }
}
