import { Test } from '@nestjs/testing';
import { ForbiddenException, NotFoundException, ConflictException } from '@nestjs/common';
import { RoomKeysService } from './room-keys.service';
import { PrismaService } from '../prisma/prisma.service';

const mockPrisma = {
  room: {
    findUnique: jest.fn(),
    findUniqueOrThrow: jest.fn(),
    updateMany: jest.fn(),
  },
  roomMember: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
  },
  roomKeyGrant: {
    findMany: jest.fn(),
    createMany: jest.fn(),
  },
  $transaction: jest.fn(),
};

describe('RoomKeysService', () => {
  let service: RoomKeysService;

  beforeEach(async () => {
    jest.clearAllMocks();
    // Interactive-transaction shape: $transaction(fn) runs fn against the
    // same mock — good enough to exercise the conditional-update-then-insert
    // sequence without a real DB.
    mockPrisma.$transaction.mockImplementation((fn: (tx: typeof mockPrisma) => unknown) => fn(mockPrisma));
    const module = await Test.createTestingModule({
      providers: [RoomKeysService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();
    service = module.get(RoomKeysService);
  });

  describe('getPending', () => {
    it('throws NotFoundException for an unknown room', async () => {
      mockPrisma.room.findUnique.mockResolvedValue(null);
      await expect(service.getPending('room-1', 'user-1')).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when the requester is not a member', async () => {
      mockPrisma.room.findUnique.mockResolvedValue({ id: 'room-1', currentKeyId: 1 });
      mockPrisma.roomMember.findUnique.mockResolvedValue(null);
      await expect(service.getPending('room-1', 'outsider')).rejects.toThrow(ForbiddenException);
    });

    it('returns an empty list when the room has no epoch yet (currentKeyId 0, E2EE disabled)', async () => {
      mockPrisma.room.findUnique.mockResolvedValue({ id: 'room-1', currentKeyId: 0 });
      mockPrisma.roomMember.findUnique.mockResolvedValue({ roomId: 'room-1', userId: 'user-1', role: 'member' });

      const result = await service.getPending('room-1', 'user-1');

      expect(result).toEqual([]);
    });

    it('lists a member missing a grant for a reached epoch, matched by current publicKeyFp — not mere row presence', async () => {
      mockPrisma.room.findUnique.mockResolvedValue({ id: 'room-1', currentKeyId: 1 });
      mockPrisma.roomMember.findUnique.mockResolvedValue({ roomId: 'room-1', userId: 'user-1', role: 'admin' });
      mockPrisma.roomMember.findMany.mockResolvedValue([
        { roomId: 'room-1', userId: 'user-2', role: 'member', user: { id: 'user-2', publicKey: 'pk2', publicKeyFp: 'fp2' } },
      ]);
      mockPrisma.roomKeyGrant.findMany.mockResolvedValue([]); // no grants at all yet

      const result = await service.getPending('room-1', 'user-1');

      expect(result).toContainEqual({ userId: 'user-2', keyId: 1, publicKey: 'pk2' });
    });

    it('does not list a member whose grant fingerprint is stale (sealed to a since-replaced publicKey)', async () => {
      mockPrisma.room.findUnique.mockResolvedValue({ id: 'room-1', currentKeyId: 1 });
      mockPrisma.roomMember.findUnique.mockResolvedValue({ roomId: 'room-1', userId: 'user-1', role: 'admin' });
      mockPrisma.roomMember.findMany.mockResolvedValue([
        { roomId: 'room-1', userId: 'user-2', role: 'member', user: { id: 'user-2', publicKey: 'pk2-new', publicKeyFp: 'fp2-new' } },
      ]);
      // Grant exists but was sealed against the OLD fingerprint — stale.
      mockPrisma.roomKeyGrant.findMany.mockResolvedValue([
        { roomId: 'room-1', userId: 'user-2', keyId: 1, recipientKeyFp: 'fp2-old' },
      ]);

      const result = await service.getPending('room-1', 'user-1');

      expect(result).toContainEqual({ userId: 'user-2', keyId: 1, publicKey: 'pk2-new' });
    });

    it('excludes a member who has not published a public key yet — nothing to wrap against', async () => {
      mockPrisma.room.findUnique.mockResolvedValue({ id: 'room-1', currentKeyId: 1 });
      mockPrisma.roomMember.findUnique.mockResolvedValue({ roomId: 'room-1', userId: 'user-1', role: 'admin' });
      mockPrisma.roomMember.findMany.mockResolvedValue([
        { roomId: 'room-1', userId: 'user-3', role: 'member', user: { id: 'user-3', publicKey: null, publicKeyFp: null } },
      ]);
      mockPrisma.roomKeyGrant.findMany.mockResolvedValue([]);

      const result = await service.getPending('room-1', 'user-1');

      expect(result).toEqual([]);
    });
  });

  describe('uploadGrants — plain grant serving (no claimEpoch, first-responder wrap)', () => {
    it('allows any member (not just admin) to serve pending grants', async () => {
      mockPrisma.roomMember.findUnique.mockResolvedValue({ roomId: 'room-1', userId: 'user-2', role: 'member' });
      mockPrisma.room.findUniqueOrThrow.mockResolvedValue({ id: 'room-1', currentKeyId: 1 });
      mockPrisma.roomKeyGrant.createMany.mockResolvedValue({ count: 1 });

      const result = await service.uploadGrants('room-1', 'user-2', {
        grants: [{ userId: 'user-3', keyId: 1, wrappedKey: 'wrapped', recipientKeyFp: 'fp3' }],
      });

      expect(mockPrisma.roomKeyGrant.createMany).toHaveBeenCalledWith({
        data: [{ roomId: 'room-1', userId: 'user-3', keyId: 1, wrappedKey: 'wrapped', recipientKeyFp: 'fp3' }],
        skipDuplicates: true,
      });
      expect(result).toEqual({ currentKeyId: 1 });
    });

    it('throws ForbiddenException when the actor is not a member', async () => {
      mockPrisma.roomMember.findUnique.mockResolvedValue(null);
      await expect(
        service.uploadGrants('room-1', 'outsider', { grants: [] }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('uploadGrants — atomic epoch claim (enablement 0->1 or rotation)', () => {
    it('requires admin role — a non-admin member cannot claim an epoch', async () => {
      mockPrisma.roomMember.findUnique.mockResolvedValue({ roomId: 'room-1', userId: 'user-2', role: 'member' });

      await expect(
        service.uploadGrants('room-1', 'user-2', {
          claimEpoch: { expectedCurrentKeyId: 0 },
          grants: [{ userId: 'user-2', keyId: 1, wrappedKey: 'w', recipientKeyFp: 'fp' }],
        }),
      ).rejects.toThrow(ForbiddenException);
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('admin: atomically bumps currentKeyId and inserts every grant row in one transaction', async () => {
      mockPrisma.roomMember.findUnique.mockResolvedValue({ roomId: 'room-1', userId: 'admin-1', role: 'admin' });
      mockPrisma.room.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.roomKeyGrant.createMany.mockResolvedValue({ count: 2 });

      const result = await service.uploadGrants('room-1', 'admin-1', {
        claimEpoch: { expectedCurrentKeyId: 0 },
        grants: [
          { userId: 'admin-1', keyId: 1, wrappedKey: 'w1', recipientKeyFp: 'fp1' },
          { userId: 'user-2', keyId: 1, wrappedKey: 'w2', recipientKeyFp: 'fp2' },
        ],
      });

      expect(mockPrisma.room.updateMany).toHaveBeenCalledWith({
        where: { id: 'room-1', currentKeyId: 0 },
        data: { currentKeyId: { increment: 1 } },
      });
      expect(mockPrisma.roomKeyGrant.createMany).toHaveBeenCalledWith({
        data: [
          { roomId: 'room-1', userId: 'admin-1', keyId: 1, wrappedKey: 'w1', recipientKeyFp: 'fp1' },
          { roomId: 'room-1', userId: 'user-2', keyId: 1, wrappedKey: 'w2', recipientKeyFp: 'fp2' },
        ],
        skipDuplicates: true,
      });
      expect(result).toEqual({ currentKeyId: 1 });
    });

    it('a losing racer (expectedCurrentKeyId stale) gets ConflictException and its transaction rolls back — no grants inserted', async () => {
      mockPrisma.roomMember.findUnique.mockResolvedValue({ roomId: 'room-1', userId: 'admin-1', role: 'admin' });
      mockPrisma.room.updateMany.mockResolvedValue({ count: 0 }); // someone else already claimed it

      await expect(
        service.uploadGrants('room-1', 'admin-1', {
          claimEpoch: { expectedCurrentKeyId: 0 },
          grants: [{ userId: 'admin-1', keyId: 1, wrappedKey: 'w1', recipientKeyFp: 'fp1' }],
        }),
      ).rejects.toThrow(ConflictException);
      expect(mockPrisma.roomKeyGrant.createMany).not.toHaveBeenCalled();
    });
  });

  describe('getMyGrants', () => {
    it('returns only the requesting user\'s own grant rows for the room', async () => {
      mockPrisma.roomMember.findUnique.mockResolvedValue({ roomId: 'room-1', userId: 'user-1', role: 'member' });
      mockPrisma.roomKeyGrant.findMany.mockResolvedValue([
        { roomId: 'room-1', userId: 'user-1', keyId: 1, wrappedKey: 'w', recipientKeyFp: 'fp' },
      ]);

      const result = await service.getMyGrants('room-1', 'user-1');

      expect(mockPrisma.roomKeyGrant.findMany).toHaveBeenCalledWith({
        where: { roomId: 'room-1', userId: 'user-1' },
        orderBy: { keyId: 'asc' },
      });
      expect(result).toHaveLength(1);
    });

    it('throws ForbiddenException when the requester is not a member', async () => {
      mockPrisma.roomMember.findUnique.mockResolvedValue(null);
      await expect(service.getMyGrants('room-1', 'outsider')).rejects.toThrow(ForbiddenException);
    });
  });
});
