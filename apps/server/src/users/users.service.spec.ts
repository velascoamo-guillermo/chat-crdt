import { Test } from '@nestjs/testing';
import { UsersService } from './users.service';
import { PrismaService } from '../prisma/prisma.service';

const mockPrisma = {
  user: {
    update: jest.fn(),
  },
  roomKeyGrant: {
    deleteMany: jest.fn(),
  },
  $transaction: jest.fn(),
};

describe('UsersService', () => {
  let service: UsersService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.$transaction.mockImplementation((ops: unknown[]) => Promise.all(ops));
    const module = await Test.createTestingModule({
      providers: [UsersService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();
    service = module.get(UsersService);
  });

  describe('setPublicKey', () => {
    it('derives publicKeyFp as a sha256 hex digest of publicKey and stores both on the user', async () => {
      mockPrisma.user.update.mockResolvedValue({});

      const result = await service.setPublicKey('user-1', 'pubkey-bytes-base64');

      expect(result.publicKeyFp).toMatch(/^[0-9a-f]{64}$/);
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { publicKey: 'pubkey-bytes-base64', publicKeyFp: result.publicKeyFp },
      });
    });

    it('is deterministic — same publicKey always yields the same fingerprint', async () => {
      mockPrisma.user.update.mockResolvedValue({});
      const a = await service.setPublicKey('user-1', 'same-key');
      const b = await service.setPublicKey('user-2', 'same-key');
      expect(a.publicKeyFp).toBe(b.publicKeyFp);
    });

    it('deletes every stale RoomKeyGrant row for this user across all rooms in the same transaction as the update (ADR-010 reinstall handling)', async () => {
      mockPrisma.user.update.mockResolvedValue({});

      await service.setPublicKey('user-1', 'new-key-after-reinstall');

      expect(mockPrisma.roomKeyGrant.deleteMany).toHaveBeenCalledWith({ where: { userId: 'user-1' } });
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    });
  });
});
