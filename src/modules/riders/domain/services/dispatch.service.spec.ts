import { AssignmentStatus } from '@prisma/client';

import { BusinessRuleViolationException } from '@/common/exceptions/domain.exception';

import { DispatchService, type DispatchCandidate, type DispatchOptions } from './dispatch.service';

// The restaurant sits at the centre of Pabbi; every candidate below is placed
// relative to it.
const PICKUP_LAT = 34.0151;
const PICKUP_LNG = 71.7938;

const NOW = new Date('2026-08-09T18:00:00.000Z');
const FRESH = new Date('2026-08-09T17:58:00.000Z');
const STALE = new Date('2026-08-09T17:00:00.000Z');

const OPTIONS: DispatchOptions = {
  searchRadiusKm: 8,
  locationFreshnessMinutes: 10,
  orderZoneId: 'zone-pabbi',
};

function candidate(overrides: Partial<DispatchCandidate> = {}): DispatchCandidate {
  return {
    driverId: 'rider-1',
    zoneId: 'zone-pabbi',
    currentLat: PICKUP_LAT,
    currentLng: PICKUP_LNG,
    lastLocationAt: FRESH,
    rating: 4,
    hasRejectedThisOrder: false,
    ...overrides,
  };
}

describe('DispatchService.rank', () => {
  const service = new DispatchService();

  it('puts the nearest rider first', () => {
    const near = candidate({ driverId: 'near', currentLat: 34.016, currentLng: 71.794 });
    const far = candidate({ driverId: 'far', currentLat: 34.06, currentLng: 71.84 });

    const ranked = service.rank([far, near], PICKUP_LAT, PICKUP_LNG, OPTIONS, NOW);

    expect(ranked.map((entry) => entry.driverId)).toEqual(['near', 'far']);
  });

  it('excludes a rider who has already declined this order', () => {
    const ranked = service.rank(
      [candidate({ driverId: 'declined', hasRejectedThisOrder: true })],
      PICKUP_LAT,
      PICKUP_LNG,
      OPTIONS,
      NOW,
    );

    expect(ranked).toEqual([]);
  });

  it('excludes a rider beyond the search radius', () => {
    // Roughly 40 km north of the restaurant.
    const ranked = service.rank(
      [candidate({ currentLat: 34.375, currentLng: 71.7938 })],
      PICKUP_LAT,
      PICKUP_LNG,
      OPTIONS,
      NOW,
    );

    expect(ranked).toEqual([]);
  });

  it('keeps a rider whose position is stale rather than discarding them', () => {
    const ranked = service.rank(
      [candidate({ lastLocationAt: STALE })],
      PICKUP_LAT,
      PICKUP_LNG,
      OPTIONS,
      NOW,
    );

    expect(ranked).toHaveLength(1);
    expect(ranked[0]?.pickupDistanceKm).toBeNull();
  });

  it('ranks a locatable rider above one whose position is stale', () => {
    const located = candidate({
      driverId: 'located',
      currentLat: 34.025,
      currentLng: 71.8,
      lastLocationAt: FRESH,
    });
    const unlocated = candidate({ driverId: 'unlocated', lastLocationAt: STALE });

    const ranked = service.rank([unlocated, located], PICKUP_LAT, PICKUP_LNG, OPTIONS, NOW);

    expect(ranked[0]?.driverId).toBe('located');
  });

  it('treats a rider with no position at all as unlocatable', () => {
    const ranked = service.rank(
      [candidate({ currentLat: null, currentLng: null })],
      PICKUP_LAT,
      PICKUP_LNG,
      OPTIONS,
      NOW,
    );

    expect(ranked[0]?.pickupDistanceKm).toBeNull();
  });

  it('prefers the rider based in the order’s zone when distances are equal', () => {
    const inZone = candidate({ driverId: 'in-zone', zoneId: 'zone-pabbi' });
    const outOfZone = candidate({ driverId: 'out-of-zone', zoneId: 'zone-nowshera' });

    const ranked = service.rank([outOfZone, inZone], PICKUP_LAT, PICKUP_LNG, OPTIONS, NOW);

    expect(ranked[0]?.driverId).toBe('in-zone');
  });

  it('breaks a tie on rating once distance and zone agree', () => {
    const better = candidate({ driverId: 'better', rating: 5 });
    const worse = candidate({ driverId: 'worse', rating: 2 });

    const ranked = service.rank([worse, better], PICKUP_LAT, PICKUP_LNG, OPTIONS, NOW);

    expect(ranked[0]?.driverId).toBe('better');
  });

  it('does not let rating outweigh being much closer', () => {
    const closeNewcomer = candidate({ driverId: 'newcomer', rating: 0 });
    const distantVeteran = candidate({
      driverId: 'veteran',
      rating: 5,
      currentLat: 34.06,
      currentLng: 71.84,
    });

    const ranked = service.rank(
      [distantVeteran, closeNewcomer],
      PICKUP_LAT,
      PICKUP_LNG,
      OPTIONS,
      NOW,
    );

    expect(ranked[0]?.driverId).toBe('newcomer');
  });

  it('reports the pickup distance in kilometres', () => {
    const ranked = service.rank(
      [candidate({ currentLat: 34.0241, currentLng: 71.7938 })],
      PICKUP_LAT,
      PICKUP_LNG,
      OPTIONS,
      NOW,
    );

    expect(ranked[0]?.pickupDistanceKm).toBeCloseTo(1, 1);
  });
});

describe('DispatchService.pick', () => {
  const service = new DispatchService();

  it('returns null when nobody is available', () => {
    expect(service.pick([], PICKUP_LAT, PICKUP_LNG, OPTIONS, NOW)).toBeNull();
  });

  it('returns the highest-ranked candidate', () => {
    const best = service.pick(
      [
        candidate({ driverId: 'far', currentLat: 34.06, currentLng: 71.84 }),
        candidate({ driverId: 'near' }),
      ],
      PICKUP_LAT,
      PICKUP_LNG,
      OPTIONS,
      NOW,
    );

    expect(best?.driverId).toBe('near');
  });
});

describe('DispatchService.assertAnswerable', () => {
  const future = new Date(NOW.getTime() + 30_000);
  const past = new Date(NOW.getTime() - 1_000);

  it('accepts an open offer inside its window', () => {
    expect(() =>
      DispatchService.assertAnswerable(AssignmentStatus.OFFERED, future, NOW),
    ).not.toThrow();
  });

  it('refuses an offer whose deadline has passed, even if still marked OFFERED', () => {
    expect(() => DispatchService.assertAnswerable(AssignmentStatus.OFFERED, past, NOW)).toThrow(
      /expired/,
    );
  });

  it('tells a rider they have already accepted this delivery', () => {
    expect(() => DispatchService.assertAnswerable(AssignmentStatus.ACCEPTED, future, NOW)).toThrow(
      /already accepted/,
    );
  });

  it('refuses an offer that was withdrawn', () => {
    expect(() => DispatchService.assertAnswerable(AssignmentStatus.CANCELLED, future, NOW)).toThrow(
      BusinessRuleViolationException,
    );
  });
});

describe('DispatchService.isLive', () => {
  it('is true only for an unanswered offer inside its window', () => {
    expect(
      DispatchService.isLive(AssignmentStatus.OFFERED, new Date(NOW.getTime() + 1000), NOW),
    ).toBe(true);
    expect(
      DispatchService.isLive(AssignmentStatus.OFFERED, new Date(NOW.getTime() - 1000), NOW),
    ).toBe(false);
    expect(
      DispatchService.isLive(AssignmentStatus.ACCEPTED, new Date(NOW.getTime() + 1000), NOW),
    ).toBe(false);
  });
});
