import {
  DriverAvailability,
  DriverDocumentStatus,
  DriverDocumentType,
  DriverStatus,
  UserRole,
  VehicleType,
} from '@prisma/client';

import {
  ForbiddenOperationException,
  ResourceConflictException,
  ResourceNotFoundException,
} from '@/common/exceptions/domain.exception';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';

import type { RiderRepository, RiderWithDetails } from '../../domain/repositories/rider.repository';
import {
  RegisterRiderUseCase,
  RiderAccessService,
  SetAvailabilityUseCase,
  UploadDocumentUseCase,
} from './rider-profile.use-cases';

const ACTOR: AuthenticatedUser = {
  id: 'user-1',
  phone: '+923005551234',
  role: UserRole.RIDER,
  permissions: [],
  sessionId: 'session-1',
};

const PAST = new Date('2020-01-01T00:00:00.000Z');
const FUTURE = new Date('2030-01-01T00:00:00.000Z');

function rider(overrides: Partial<RiderWithDetails> = {}): RiderWithDetails {
  return {
    id: 'rider-1',
    userId: 'user-1',
    cnic: '1710112345678',
    status: DriverStatus.ACTIVE,
    availability: DriverAvailability.OFFLINE,
    rejectionReason: null,
    rating: 0,
    ratingCount: 0,
    totalDeliveries: 0,
    payoutBankName: null,
    payoutAccountTitle: null,
    payoutAccountNumber: null,
    user: {
      id: 'user-1',
      fullName: 'Bilal Ahmed',
      phone: '+923005551234',
      email: null,
      avatarUrl: null,
    },
    zone: null,
    vehicles: [{ id: 'vehicle-1', type: VehicleType.MOTORCYCLE, isActive: true, isPrimary: true }],
    documents: [],
    createdAt: new Date(),
    ...overrides,
  } as unknown as RiderWithDetails;
}

function mockRepository(overrides: Partial<jest.Mocked<RiderRepository>> = {}) {
  return {
    findByUserId: jest.fn().mockResolvedValue(rider()),
    existsByCnic: jest.fn().mockResolvedValue(false),
    register: jest.fn().mockImplementation(() => Promise.resolve(rider())),
    setAvailability: jest
      .fn()
      .mockImplementation((_id, availability) => Promise.resolve(rider({ availability }))),
    upsertDocument: jest.fn().mockImplementation((input: Record<string, unknown>) =>
      Promise.resolve({
        id: 'doc-1',
        status: DriverDocumentStatus.PENDING,
        rejectionReason: null,
        reviewedAt: null,
        createdAt: new Date(),
        ...input,
      }),
    ),
    ...overrides,
  } as unknown as jest.Mocked<RiderRepository>;
}

describe('RiderAccessService', () => {
  it('reports no profile when the caller has not registered', async () => {
    const repository = mockRepository({
      findByUserId: jest.fn().mockResolvedValue(null),
    });

    await expect(new RiderAccessService(repository).mine(ACTOR)).rejects.toThrow(
      ResourceNotFoundException,
    );
  });

  it('refuses operational access while an application is under review', async () => {
    const repository = mockRepository({
      findByUserId: jest.fn().mockResolvedValue(rider({ status: DriverStatus.PENDING_APPROVAL })),
    });

    await expect(new RiderAccessService(repository).approved(ACTOR)).rejects.toThrow(
      /still under review/,
    );
  });

  it('tells a rejected applicant why, so the refusal is actionable', async () => {
    const repository = mockRepository({
      findByUserId: jest
        .fn()
        .mockResolvedValue(
          rider({ status: DriverStatus.REJECTED, rejectionReason: 'CNIC could not be verified.' }),
        ),
    });

    await expect(new RiderAccessService(repository).approved(ACTOR)).rejects.toThrow(
      /CNIC could not be verified/,
    );
  });

  it('lets an approved rider through', async () => {
    const repository = mockRepository();

    await expect(new RiderAccessService(repository).approved(ACTOR)).resolves.toMatchObject({
      id: 'rider-1',
    });
  });
});

describe('RegisterRiderUseCase', () => {
  const application = {
    cnic: '1710112345678',
    vehicle: { type: VehicleType.MOTORCYCLE, plateNumber: 'PES-4821' },
  };

  it('opens an application for a first-time rider', async () => {
    const repository = mockRepository({
      findByUserId: jest.fn().mockResolvedValue(null),
    });
    const useCase = new RegisterRiderUseCase(repository);

    await useCase.execute(ACTOR, application);

    expect(repository.register).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1', cnic: '1710112345678' }),
    );
  });

  it('refuses a second profile for the same account', async () => {
    const useCase = new RegisterRiderUseCase(mockRepository());

    await expect(useCase.execute(ACTOR, application)).rejects.toThrow(ResourceConflictException);
  });

  it('refuses a CNIC already registered to another rider', async () => {
    const repository = mockRepository({
      findByUserId: jest.fn().mockResolvedValue(null),
      existsByCnic: jest.fn().mockResolvedValue(true),
    });
    const useCase = new RegisterRiderUseCase(repository);

    await expect(useCase.execute(ACTOR, application)).rejects.toThrow(/already registered/);
  });

  it('requires a plate number for a motorcycle', async () => {
    const repository = mockRepository({
      findByUserId: jest.fn().mockResolvedValue(null),
    });
    const useCase = new RegisterRiderUseCase(repository);

    await expect(
      useCase.execute(ACTOR, { ...application, vehicle: { type: VehicleType.MOTORCYCLE } }),
    ).rejects.toThrow(/plate number/);
  });

  it('does not ask a rider on foot for a plate number', async () => {
    const repository = mockRepository({
      findByUserId: jest.fn().mockResolvedValue(null),
    });
    const useCase = new RegisterRiderUseCase(repository);

    await useCase.execute(ACTOR, { ...application, vehicle: { type: VehicleType.ON_FOOT } });

    expect(repository.register).toHaveBeenCalledWith(
      expect.objectContaining({ vehicle: expect.objectContaining({ plateNumber: null }) }),
    );
  });
});

describe('SetAvailabilityUseCase', () => {
  function verified(type: DriverDocumentType, expiresAt: Date | null) {
    return { id: `doc-${type}`, type, status: DriverDocumentStatus.VERIFIED, expiresAt };
  }

  it('takes a rider online and records the position they reported', async () => {
    const repository = mockRepository();
    const useCase = new SetAvailabilityUseCase(repository, new RiderAccessService(repository));

    await useCase.execute(ACTOR, {
      availability: DriverAvailability.ONLINE,
      latitude: 34.0151,
      longitude: 71.7938,
    });

    expect(repository.setAvailability).toHaveBeenCalledWith('rider-1', DriverAvailability.ONLINE, {
      latitude: 34.0151,
      longitude: 71.7938,
    });
  });

  it('takes a rider online without a position when none is supplied', async () => {
    const repository = mockRepository();
    const useCase = new SetAvailabilityUseCase(repository, new RiderAccessService(repository));

    await useCase.execute(ACTOR, { availability: DriverAvailability.ONLINE });

    expect(repository.setAvailability).toHaveBeenCalledWith(
      'rider-1',
      DriverAvailability.ONLINE,
      null,
    );
  });

  it('refuses to change availability mid-delivery', async () => {
    const repository = mockRepository({
      findByUserId: jest
        .fn()
        .mockResolvedValue(rider({ availability: DriverAvailability.ON_DELIVERY })),
    });
    const useCase = new SetAvailabilityUseCase(repository, new RiderAccessService(repository));

    await expect(
      useCase.execute(ACTOR, { availability: DriverAvailability.OFFLINE }),
    ).rejects.toThrow(/Finish or hand back your current delivery/);
  });

  it('refuses to take a rider online with an expired licence', async () => {
    const repository = mockRepository({
      findByUserId: jest.fn().mockResolvedValue(
        rider({
          documents: [
            verified(DriverDocumentType.DRIVING_LICENSE, PAST),
          ] as unknown as RiderWithDetails['documents'],
        }),
      ),
    });
    const useCase = new SetAvailabilityUseCase(repository, new RiderAccessService(repository));

    await expect(
      useCase.execute(ACTOR, { availability: DriverAvailability.ONLINE }),
    ).rejects.toThrow(/DRIVING_LICENSE/);
    expect(repository.setAvailability).not.toHaveBeenCalled();
  });

  it('allows a rider online when their documents are still current', async () => {
    const repository = mockRepository({
      findByUserId: jest.fn().mockResolvedValue(
        rider({
          documents: [
            verified(DriverDocumentType.DRIVING_LICENSE, FUTURE),
          ] as unknown as RiderWithDetails['documents'],
        }),
      ),
    });
    const useCase = new SetAvailabilityUseCase(repository, new RiderAccessService(repository));

    await expect(
      useCase.execute(ACTOR, { availability: DriverAvailability.ONLINE }),
    ).resolves.toBeDefined();
  });

  it('lets a rider go offline without re-checking their paperwork', async () => {
    const repository = mockRepository({
      findByUserId: jest.fn().mockResolvedValue(
        rider({
          documents: [
            verified(DriverDocumentType.DRIVING_LICENSE, PAST),
          ] as unknown as RiderWithDetails['documents'],
        }),
      ),
    });
    const useCase = new SetAvailabilityUseCase(repository, new RiderAccessService(repository));

    await expect(
      useCase.execute(ACTOR, { availability: DriverAvailability.OFFLINE }),
    ).resolves.toBeDefined();
  });

  it('refuses a suspended rider outright', async () => {
    const repository = mockRepository({
      findByUserId: jest.fn().mockResolvedValue(rider({ status: DriverStatus.SUSPENDED })),
    });
    const useCase = new SetAvailabilityUseCase(repository, new RiderAccessService(repository));

    await expect(
      useCase.execute(ACTOR, { availability: DriverAvailability.ONLINE }),
    ).rejects.toThrow(ForbiddenOperationException);
  });
});

describe('UploadDocumentUseCase', () => {
  const upload = {
    type: DriverDocumentType.DRIVING_LICENSE,
    fileUrl: 'https://cdn.zassdelivery.pk/riders/licence.jpg',
  };

  it('files a document for review', async () => {
    const repository = mockRepository();
    const useCase = new UploadDocumentUseCase(repository, new RiderAccessService(repository));

    const result = await useCase.execute(ACTOR, upload);

    expect(result.status).toBe(DriverDocumentStatus.PENDING);
    expect(repository.upsertDocument).toHaveBeenCalledWith(
      expect.objectContaining({ driverId: 'rider-1', type: DriverDocumentType.DRIVING_LICENSE }),
    );
  });

  it('refuses a document that has already expired', async () => {
    const repository = mockRepository();
    const useCase = new UploadDocumentUseCase(repository, new RiderAccessService(repository));

    await expect(useCase.execute(ACTOR, { ...upload, expiresAt: PAST })).rejects.toThrow(
      /already expired/,
    );
    expect(repository.upsertDocument).not.toHaveBeenCalled();
  });

  it('accepts an application document from a rider who is not yet approved', async () => {
    const repository = mockRepository({
      findByUserId: jest.fn().mockResolvedValue(rider({ status: DriverStatus.PENDING_APPROVAL })),
    });
    const useCase = new UploadDocumentUseCase(repository, new RiderAccessService(repository));

    await expect(useCase.execute(ACTOR, upload)).resolves.toBeDefined();
  });
});
