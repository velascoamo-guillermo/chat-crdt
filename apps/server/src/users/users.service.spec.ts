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
    it('derives publicKeyFp as a BLAKE2b-512 hex digest of publicKey and stores both on the user', async () => {
      // BLAKE2b, not SHA-256: react-native-libsodium exposes crypto_generichash
      // (BLAKE2b) but no plain SHA-256 primitive, and the mobile client must
      // independently reproduce this exact fingerprint (ADR-010: the uploader
      // supplies recipientKeyFp verbatim) — so both sides need a hash
      // algorithm they can both compute. 64-byte output = 128 hex chars,
      // matching Node's `blake2b512` digest length.
      mockPrisma.user.update.mockResolvedValue({});

      const result = await service.setPublicKey('user-1', 'pubkey-bytes-base64');

      expect(result.publicKeyFp).toMatch(/^[0-9a-f]{128}$/);
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { publicKey: 'pubkey-bytes-base64', publicKeyFp: result.publicKeyFp },
      });
    });

    it('matches a hardcoded expected digest for a known input (code review round 1, Important #8 — cross-side fp pin)', async () => {
      // Same pinned input/output pair as
      // apps/mobile/src/crypto/keyFlows.test.ts's computePublicKeyFp pin
      // test — the mobile client independently recomputes this exact
      // fingerprint for RoomKeyGrant.recipientKeyFp (ADR-010: supplied
      // verbatim by the uploader), so both implementations must agree
      // bit-for-bit on the same input or a legitimately-granted member's
      // grant would never match here and dead-end silently in
      // getPending() forever.
      mockPrisma.user.update.mockResolvedValue({});

      const result = await service.setPublicKey('user-1', 'e2ee-fp-pin-test-vector');

      expect(result.publicKeyFp).toBe(
        '009be997ee9932add4e77a198900627bd485de0f425d7f0b7143122bfa05b14a702a2ae7fb9f081b19d12cf766f4bcb2897f54453c13ee2953dceed5ddaf6226'
      );
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
