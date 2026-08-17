import { Test, TestingModule } from '@nestjs/testing';
import { Firestore, Timestamp } from '@google-cloud/firestore';
import { AdminUsersService } from './admin-users.service';
import { FIRESTORE } from '../database/firestore.module';

// Firestore is faked at the query-builder level — collection().where().limit().get()
const mockGet = jest.fn();
const mockLimit = jest.fn(() => ({ get: mockGet }));
const mockWhere = jest.fn(() => ({ limit: mockLimit }));
const mockCollection = jest.fn(() => ({ where: mockWhere }));
const mockFirestore = { collection: mockCollection } as unknown as Firestore;

const snapshotOf = (docs: { id: string; data: Record<string, unknown> }[]) => ({
  empty: docs.length === 0,
  docs: docs.map((doc) => ({ id: doc.id, data: () => doc.data })),
});

describe('AdminUsersService', () => {
  let service: AdminUsersService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [AdminUsersService, { provide: FIRESTORE, useValue: mockFirestore }],
    }).compile();
    service = module.get(AdminUsersService);
  });

  it('queries the admin_users collection by email', async () => {
    mockGet.mockResolvedValue(snapshotOf([]));
    await service.findByEmail('admin@example.com');
    expect(mockCollection).toHaveBeenCalledWith('admin_users');
    expect(mockWhere).toHaveBeenCalledWith('email', '==', 'admin@example.com');
    expect(mockLimit).toHaveBeenCalledWith(1);
  });

  it('returns null when no admin matches the email', async () => {
    mockGet.mockResolvedValue(snapshotOf([]));
    await expect(service.findByEmail('stranger@example.com')).resolves.toBeNull();
  });

  it('maps the document id and stored column names onto AdminUser', async () => {
    mockGet.mockResolvedValue(
      snapshotOf([
        {
          id: 'e3f9c1de-1f2a-4a10-9d51-0a1d3f5b7c22',
          data: {
            email: 'admin@example.com',
            password_hash: '$2b$10$hash',
            google_id: 'google-sub-1',
            created_at: Timestamp.now(),
          },
        },
      ])
    );

    await expect(service.findByEmail('admin@example.com')).resolves.toEqual({
      id: 'e3f9c1de-1f2a-4a10-9d51-0a1d3f5b7c22',
      email: 'admin@example.com',
      passwordHash: '$2b$10$hash',
      googleId: 'google-sub-1',
    });
  });

  it('reports a missing password hash and google id as null', async () => {
    mockGet.mockResolvedValue(
      snapshotOf([{ id: 'uuid-1', data: { email: 'seeded@example.com' } }])
    );

    await expect(service.findByEmail('seeded@example.com')).resolves.toEqual({
      id: 'uuid-1',
      email: 'seeded@example.com',
      passwordHash: null,
      googleId: null,
    });
  });
});
