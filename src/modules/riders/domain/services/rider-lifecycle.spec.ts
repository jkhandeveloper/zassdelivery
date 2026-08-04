import { DriverAvailability, DriverDocumentType, DriverStatus } from '@prisma/client';

import { BusinessRuleViolationException } from '@/common/exceptions/domain.exception';

import { RiderLifecycle } from './rider-lifecycle';

describe('RiderLifecycle.assertTransition', () => {
  it('allows a pending application to be approved', () => {
    expect(() =>
      RiderLifecycle.assertTransition(DriverStatus.PENDING_APPROVAL, DriverStatus.ACTIVE),
    ).not.toThrow();
  });

  it('allows a pending application to be rejected', () => {
    expect(() =>
      RiderLifecycle.assertTransition(DriverStatus.PENDING_APPROVAL, DriverStatus.REJECTED),
    ).not.toThrow();
  });

  it('refuses to move a rider to the status they already hold', () => {
    expect(() => RiderLifecycle.assertTransition(DriverStatus.ACTIVE, DriverStatus.ACTIVE)).toThrow(
      BusinessRuleViolationException,
    );
  });

  it('refuses to put a rejected applicant straight on the road', () => {
    expect(() =>
      RiderLifecycle.assertTransition(DriverStatus.REJECTED, DriverStatus.ACTIVE),
    ).toThrow(/cannot move from REJECTED to ACTIVE/);
  });

  it('sends a rejected application back through review', () => {
    expect(() =>
      RiderLifecycle.assertTransition(DriverStatus.REJECTED, DriverStatus.PENDING_APPROVAL),
    ).not.toThrow();
  });

  it('lets a suspension be lifted', () => {
    expect(() =>
      RiderLifecycle.assertTransition(DriverStatus.SUSPENDED, DriverStatus.ACTIVE),
    ).not.toThrow();
  });

  it('names the legal alternatives when a move is refused', () => {
    expect(() =>
      RiderLifecycle.assertTransition(DriverStatus.ACTIVE, DriverStatus.PENDING_APPROVAL),
    ).toThrow(/Allowed: SUSPENDED/);
  });
});

describe('RiderLifecycle.missingDocuments', () => {
  const identityDocuments = [
    DriverDocumentType.CNIC_FRONT,
    DriverDocumentType.CNIC_BACK,
    DriverDocumentType.PROFILE_PHOTO,
  ];

  it('reports nothing outstanding for a cyclist with identity documents on file', () => {
    expect(
      RiderLifecycle.missingDocuments(identityDocuments, { requiresVehicleDocuments: false }),
    ).toEqual([]);
  });

  it('still wants a licence and registration from a motorcyclist', () => {
    expect(
      RiderLifecycle.missingDocuments(identityDocuments, { requiresVehicleDocuments: true }),
    ).toEqual([DriverDocumentType.DRIVING_LICENSE, DriverDocumentType.VEHICLE_REGISTRATION]);
  });

  it('lists every identity document an empty application is missing', () => {
    expect(RiderLifecycle.missingDocuments([], { requiresVehicleDocuments: false })).toEqual(
      identityDocuments,
    );
  });

  it('ignores documents that were never required', () => {
    expect(
      RiderLifecycle.missingDocuments(
        [...identityDocuments, DriverDocumentType.VEHICLE_REGISTRATION],
        { requiresVehicleDocuments: false },
      ),
    ).toEqual([]);
  });
});

describe('RiderLifecycle.canReceiveOffers', () => {
  it('offers work to an approved rider who is online', () => {
    expect(RiderLifecycle.canReceiveOffers(DriverStatus.ACTIVE, DriverAvailability.ONLINE)).toBe(
      true,
    );
  });

  it('does not offer work to a rider who is already carrying an order', () => {
    expect(
      RiderLifecycle.canReceiveOffers(DriverStatus.ACTIVE, DriverAvailability.ON_DELIVERY),
    ).toBe(false);
  });

  it('does not offer work to a rider on a break', () => {
    expect(RiderLifecycle.canReceiveOffers(DriverStatus.ACTIVE, DriverAvailability.ON_BREAK)).toBe(
      false,
    );
  });

  it('does not offer work to a suspended rider, however available they look', () => {
    expect(RiderLifecycle.canReceiveOffers(DriverStatus.SUSPENDED, DriverAvailability.ONLINE)).toBe(
      false,
    );
  });
});
