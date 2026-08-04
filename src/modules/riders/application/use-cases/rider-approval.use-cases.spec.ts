import {
  DriverAvailability,
  DriverDocumentStatus,
  DriverDocumentType,
  DriverStatus,
  UserRole,
  VehicleType,
} from '@prisma/client';

import {
  BusinessRuleViolationException,
  ResourceNotFoundException,
} from '@/common/exceptions/domain.exception';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';

import type { RiderRepository, RiderWithDetails } from '../../domain/repositories/rider.repository';
import {
  ApproveRiderUseCase,
  ReviewDocumentUseCase,
  SuspendRiderUseCase,
} from './rider-approval.use-cases';
import { RiderAccessService } from './rider-profile.use-cases';

const REVIEWER: AuthenticatedUser = {
  id: 'admin-1',
  phone: '+923000000001',
  role: UserRole.ADMIN,
  permissions: ['drivers.approve'],
  sessionId: 'session-1',
};

const FUTURE = new Date('2030-01-01T00:00:00.000Z');
const PAST = new Date('2020-01-01T00:00:00.000Z');

function document(type: DriverDocumentType, overrides: Record<string, unknown> = {}) {
  return {
    id: `doc-${type}`,
    driverId: 'rider-1',
    type,
    status: DriverDocumentStatus.VERIFIED,
    fileUrl: 'https://cdn.zassdelivery.pk/riders/doc.jpg',
    number: null,
    expiresAt: null,
    rejectionReason: null,
    reviewedById: REVIEWER.id,
    reviewedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as RiderWithDetails['documents'][number];
}

function rider(overrides: Partial<RiderWithDetails> = {}): RiderWithDetails {
  return {
    id: 'rider-1',
    userId: 'user-1',
    cnic: '1710112345678',
    licenseNumber: 'KPK-2019-887766',
    status: DriverStatus.PENDING_APPROVAL,
    availability: DriverAvailability.OFFLINE,
    rejectionReason: null,
    approvedById: null,
    zoneId: 'zone-pabbi',
    currentLat: null,
    currentLng: null,
    lastLocationAt: null,
    onlineSince: null,
    rating: 0 as unknown as RiderWithDetails['rating'],
    ratingCount: 0,
    totalDeliveries: 0,
    payoutBankName: null,
    payoutAccountTitle: null,
    payoutAccountNumber: null,
    verifiedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    user: {
      id: 'user-1',
      fullName: 'Bilal Ahmed',
      phone: '+923005551234',
      email: null,
      avatarUrl: null,
      status: 'ACTIVE',
    },
    zone: { id: 'zone-pabbi', name: 'Pabbi Central' },
    vehicles: [
      {
        id: 'vehicle-1',
        driverId: 'rider-1',
        type: VehicleType.MOTORCYCLE,
        make: 'Honda',
        model: 'CD 70',
        year: 2022,
        color: 'Red',
        plateNumber: 'PES-4821',
        registrationDocUrl: null,
        isPrimary: true,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ],
    documents: [],
    ...overrides,
  };
}

const FULL_MOTORCYCLE_SET = [
  document(DriverDocumentType.CNIC_FRONT),
  document(DriverDocumentType.CNIC_BACK),
  document(DriverDocumentType.PROFILE_PHOTO),
  document(DriverDocumentType.DRIVING_LICENSE, { expiresAt: FUTURE }),
  document(DriverDocumentType.VEHICLE_REGISTRATION),
];

function mockRepository(loaded: RiderWithDetails): jest.Mocked<RiderRepository> {
  return {
    findById: jest.fn().mockResolvedValue(loaded),
    setStatus: jest
      .fn()
      .mockImplementation((_id, input) =>
        Promise.resolve(rider({ ...loaded, status: input.status })),
      ),
    reviewDocument: jest
      .fn()
      .mockImplementation((id, input) =>
        Promise.resolve(document(DriverDocumentType.CNIC_FRONT, { id, status: input.status })),
      ),
    findDocument: jest.fn(),
  } as unknown as jest.Mocked<RiderRepository>;
}

describe('ApproveRiderUseCase', () => {
  it('approves a rider whose documents are all verified', async () => {
    const applicant = rider({ documents: FULL_MOTORCYCLE_SET });
    const repository = mockRepository(applicant);
    const useCase = new ApproveRiderUseCase(repository, new RiderAccessService(repository));

    const result = await useCase.execute('rider-1', REVIEWER);

    expect(result.status).toBe(DriverStatus.ACTIVE);
    expect(repository.setStatus).toHaveBeenCalledWith('rider-1', {
      status: DriverStatus.ACTIVE,
      reviewerId: REVIEWER.id,
      rejectionReason: null,
      verified: true,
    });
  });

  it('refuses to approve an application with no documents at all', async () => {
    const repository = mockRepository(rider());
    const useCase = new ApproveRiderUseCase(repository, new RiderAccessService(repository));

    await expect(useCase.execute('rider-1', REVIEWER)).rejects.toThrow(
      BusinessRuleViolationException,
    );
    expect(repository.setStatus).not.toHaveBeenCalled();
  });

  it('names the documents that are still outstanding', async () => {
    const repository = mockRepository(
      rider({
        documents: [
          document(DriverDocumentType.CNIC_FRONT),
          document(DriverDocumentType.CNIC_BACK),
          document(DriverDocumentType.PROFILE_PHOTO),
        ],
      }),
    );
    const useCase = new ApproveRiderUseCase(repository, new RiderAccessService(repository));

    await expect(useCase.execute('rider-1', REVIEWER)).rejects.toThrow(
      /DRIVING_LICENSE, VEHICLE_REGISTRATION/,
    );
  });

  it('does not count a document that is still pending review', async () => {
    const repository = mockRepository(
      rider({
        documents: FULL_MOTORCYCLE_SET.map((entry, index) =>
          index === 0 ? { ...entry, status: DriverDocumentStatus.PENDING } : entry,
        ),
      }),
    );
    const useCase = new ApproveRiderUseCase(repository, new RiderAccessService(repository));

    await expect(useCase.execute('rider-1', REVIEWER)).rejects.toThrow(/CNIC_FRONT/);
  });

  it('does not count a verified document that has since expired', async () => {
    const repository = mockRepository(
      rider({
        documents: FULL_MOTORCYCLE_SET.map((entry) =>
          entry.type === DriverDocumentType.DRIVING_LICENSE ? { ...entry, expiresAt: PAST } : entry,
        ),
      }),
    );
    const useCase = new ApproveRiderUseCase(repository, new RiderAccessService(repository));

    await expect(useCase.execute('rider-1', REVIEWER)).rejects.toThrow(/DRIVING_LICENSE/);
  });

  it('does not ask a cyclist for a licence or vehicle registration', async () => {
    const repository = mockRepository(
      rider({
        vehicles: [
          { ...rider().vehicles[0], type: VehicleType.BICYCLE },
        ] as RiderWithDetails['vehicles'],
        documents: [
          document(DriverDocumentType.CNIC_FRONT),
          document(DriverDocumentType.CNIC_BACK),
          document(DriverDocumentType.PROFILE_PHOTO),
        ],
      }),
    );
    const useCase = new ApproveRiderUseCase(repository, new RiderAccessService(repository));

    await expect(useCase.execute('rider-1', REVIEWER)).resolves.toMatchObject({
      status: DriverStatus.ACTIVE,
    });
  });

  it('refuses to approve a rider who is already active', async () => {
    const repository = mockRepository(
      rider({ status: DriverStatus.ACTIVE, documents: FULL_MOTORCYCLE_SET }),
    );
    const useCase = new ApproveRiderUseCase(repository, new RiderAccessService(repository));

    await expect(useCase.execute('rider-1', REVIEWER)).rejects.toThrow(/already ACTIVE/);
  });

  it('reports an unknown rider as not found', async () => {
    const repository = mockRepository(rider());
    repository.findById.mockResolvedValue(null);
    const useCase = new ApproveRiderUseCase(repository, new RiderAccessService(repository));

    await expect(useCase.execute('missing', REVIEWER)).rejects.toThrow(ResourceNotFoundException);
  });
});

describe('SuspendRiderUseCase', () => {
  const reason = { reason: 'Repeated late deliveries under investigation.' };

  it('suspends an active rider', async () => {
    const repository = mockRepository(rider({ status: DriverStatus.ACTIVE }));
    const useCase = new SuspendRiderUseCase(repository, new RiderAccessService(repository));

    await expect(useCase.execute('rider-1', reason, REVIEWER)).resolves.toMatchObject({
      status: DriverStatus.SUSPENDED,
    });
  });

  it('refuses to suspend a rider who is carrying an order', async () => {
    const repository = mockRepository(
      rider({ status: DriverStatus.ACTIVE, availability: DriverAvailability.ON_DELIVERY }),
    );
    const useCase = new SuspendRiderUseCase(repository, new RiderAccessService(repository));

    await expect(useCase.execute('rider-1', reason, REVIEWER)).rejects.toThrow(
      /Reassign the order before suspending/,
    );
    expect(repository.setStatus).not.toHaveBeenCalled();
  });
});

describe('ReviewDocumentUseCase', () => {
  it('verifies a current document', async () => {
    const repository = mockRepository(rider());
    repository.findDocument.mockResolvedValue(document(DriverDocumentType.CNIC_FRONT));
    const useCase = new ReviewDocumentUseCase(repository);

    await useCase.verify('doc-1', REVIEWER);

    expect(repository.reviewDocument).toHaveBeenCalledWith('doc-1', {
      status: DriverDocumentStatus.VERIFIED,
      reviewerId: REVIEWER.id,
      rejectionReason: null,
    });
  });

  it('refuses to verify a document that has already expired', async () => {
    const repository = mockRepository(rider());
    repository.findDocument.mockResolvedValue(
      document(DriverDocumentType.DRIVING_LICENSE, { expiresAt: PAST }),
    );
    const useCase = new ReviewDocumentUseCase(repository);

    await expect(useCase.verify('doc-1', REVIEWER)).rejects.toThrow(/expired/);
    expect(repository.reviewDocument).not.toHaveBeenCalled();
  });

  it('records the reason when a document is rejected', async () => {
    const repository = mockRepository(rider());
    repository.findDocument.mockResolvedValue(document(DriverDocumentType.CNIC_FRONT));
    const useCase = new ReviewDocumentUseCase(repository);

    await useCase.reject('doc-1', { reason: 'The photo is too blurred to read.' }, REVIEWER);

    expect(repository.reviewDocument).toHaveBeenCalledWith('doc-1', {
      status: DriverDocumentStatus.REJECTED,
      reviewerId: REVIEWER.id,
      rejectionReason: 'The photo is too blurred to read.',
    });
  });
});
