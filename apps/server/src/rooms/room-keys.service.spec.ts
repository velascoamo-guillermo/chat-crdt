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
    upsert: jest.fn(),
  },
  $transaction: jest.fn(),
};

// A SEPARATE mock object for the transaction-scoped client (code review
// round 1, Important #7) — the previous version of this test ran
// $transaction's callback against the very same `mockPrisma` used outside
// it, so a bug that performed the conditional currentKeyId update (or the
// grant inserts) OUTSIDE the transaction — reopening the exact orphan-epoch
// race the transaction exists to close — would have passed every assertion
// here anyway, since `tx.room.updateMany` and `mockPrisma.room.updateMany`
// were literally the same jest.fn(). Now they're distinct: the atomic-claim
// tests assert the tx-scoped mock was called AND that the outer, non-tx
// mock was NOT — an implementation that moved either the update or the
// grant upserts outside the transaction fails this test.
const txPrisma = {
  room: { updateMany: jest.fn() },
  roomKeyGrant: { upsert: jest.fn() },
};

describe('RoomKeysService', () => {
  let service: RoomKeysService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.$transaction.mockImplementation((fn: (tx: typeof txPrisma) => unknown) => fn(txPrisma));
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
      mockPrisma.roomMember.findMany.mockResolvedValue([{ userId: 'user-2' }, { userId: 'user-3' }]);
      mockPrisma.room.findUniqueOrThrow.mockResolvedValue({ id: 'room-1', currentKeyId: 1 });
      mockPrisma.roomKeyGrant.upsert.mockResolvedValue({});

      const result = await service.uploadGrants('room-1', 'user-2', {
        grants: [{ userId: 'user-3', keyId: 1, wrappedKey: 'wrapped', recipientKeyFp: 'fp3' }],
      });

      expect(mockPrisma.roomKeyGrant.upsert).toHaveBeenCalledWith({
        where: { roomId_userId_keyId: { roomId: 'room-1', userId: 'user-3', keyId: 1 } },
        create: { roomId: 'room-1', userId: 'user-3', keyId: 1, wrappedKey: 'wrapped', recipientKeyFp: 'fp3' },
        update: { wrappedKey: 'wrapped', recipientKeyFp: 'fp3' },
      });
      expect(result).toEqual({ currentKeyId: 1 });
    });

    it('throws ForbiddenException when the actor is not a member', async () => {
      mockPrisma.roomMember.findUnique.mockResolvedValue(null);
      await expect(
        service.uploadGrants('room-1', 'outsider', { grants: [] }),
      ).rejects.toThrow(ForbiddenException);
    });

    // Important #2: re-serving a grant after the recipient's fp was
    // invalidated (reinstall) must actually UPDATE the existing
    // (roomId, userId, keyId) row, not silently no-op — see upsertGrants'
    // doc comment. Asserting the upsert call's `update` clause (rather than
    // mocking a "row already exists" DB state, which the mock can't
    // represent) is the unit-testable half of this; upsert's actual
    // create-vs-update branching is Prisma/Postgres's own guarantee.
    it('re-serves (upserts, not skips) a grant for a member whose previous grant is now stale', async () => {
      mockPrisma.roomMember.findUnique.mockResolvedValue({ roomId: 'room-1', userId: 'user-2', role: 'member' });
      mockPrisma.roomMember.findMany.mockResolvedValue([{ userId: 'user-2' }, { userId: 'stranded-user' }]);
      mockPrisma.room.findUniqueOrThrow.mockResolvedValue({ id: 'room-1', currentKeyId: 1 });
      mockPrisma.roomKeyGrant.upsert.mockResolvedValue({});

      await service.uploadGrants('room-1', 'user-2', {
        grants: [{ userId: 'stranded-user', keyId: 1, wrappedKey: 'new-wrapped', recipientKeyFp: 'new-fp' }],
      });

      expect(mockPrisma.roomKeyGrant.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { roomId_userId_keyId: { roomId: 'room-1', userId: 'stranded-user', keyId: 1 } },
          update: { wrappedKey: 'new-wrapped', recipientKeyFp: 'new-fp' },
        }),
      );
    });

    it('throws ForbiddenException when a grant targets a userId who is not a member of the room', async () => {
      mockPrisma.roomMember.findUnique.mockResolvedValue({ roomId: 'room-1', userId: 'user-2', role: 'member' });
      mockPrisma.roomMember.findMany.mockResolvedValue([{ userId: 'user-2' }]);

      await expect(
        service.uploadGrants('room-1', 'user-2', {
          grants: [{ userId: 'not-a-member', keyId: 1, wrappedKey: 'w', recipientKeyFp: 'fp' }],
        }),
      ).rejects.toThrow(ForbiddenException);
      expect(mockPrisma.roomKeyGrant.upsert).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException when a plain (non-claim) grant targets an epoch beyond the room\'s current one', async () => {
      mockPrisma.roomMember.findUnique.mockResolvedValue({ roomId: 'room-1', userId: 'user-2', role: 'member' });
      mockPrisma.roomMember.findMany.mockResolvedValue([{ userId: 'user-2' }]);
      mockPrisma.room.findUniqueOrThrow.mockResolvedValue({ id: 'room-1', currentKeyId: 1 });

      await expect(
        service.uploadGrants('room-1', 'user-2', {
          grants: [{ userId: 'user-2', keyId: 2, wrappedKey: 'w', recipientKeyFp: 'fp' }], // epoch 2 doesn't exist yet
        }),
      ).rejects.toThrow(ForbiddenException);
      expect(mockPrisma.roomKeyGrant.upsert).not.toHaveBeenCalled();
    });
  });

  describe('uploadGrants — atomic epoch claim (enablement 0->1 or rotation)', () => {
    it('requires admin role — a non-admin member cannot claim an epoch', async () => {
      mockPrisma.roomMember.findUnique.mockResolvedValue({ roomId: 'room-1', userId: 'user-2', role: 'member' });
      mockPrisma.roomMember.findMany.mockResolvedValue([{ userId: 'user-2' }]);

      await expect(
        service.uploadGrants('room-1', 'user-2', {
          claimEpoch: { expectedCurrentKeyId: 0 },
          grants: [{ userId: 'user-2', keyId: 1, wrappedKey: 'w', recipientKeyFp: 'fp' }],
        }),
      ).rejects.toThrow(ForbiddenException);
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('admin: atomically bumps currentKeyId and upserts every grant row INSIDE the same transaction', async () => {
      mockPrisma.roomMember.findUnique.mockResolvedValue({ roomId: 'room-1', userId: 'admin-1', role: 'admin' });
      mockPrisma.roomMember.findMany.mockResolvedValue([{ userId: 'admin-1' }, { userId: 'user-2' }]);
      txPrisma.room.updateMany.mockResolvedValue({ count: 1 });
      txPrisma.roomKeyGrant.upsert.mockResolvedValue({});

      const result = await service.uploadGrants('room-1', 'admin-1', {
        claimEpoch: { expectedCurrentKeyId: 0 },
        grants: [
          { userId: 'admin-1', keyId: 1, wrappedKey: 'w1', recipientKeyFp: 'fp1' },
          { userId: 'user-2', keyId: 1, wrappedKey: 'w2', recipientKeyFp: 'fp2' },
        ],
      });

      // Important #7: both statements happened on the TX-scoped client...
      expect(txPrisma.room.updateMany).toHaveBeenCalledWith({
        where: { id: 'room-1', currentKeyId: 0 },
        data: { currentKeyId: { increment: 1 } },
      });
      expect(txPrisma.roomKeyGrant.upsert).toHaveBeenCalledWith({
        where: { roomId_userId_keyId: { roomId: 'room-1', userId: 'admin-1', keyId: 1 } },
        create: { roomId: 'room-1', userId: 'admin-1', keyId: 1, wrappedKey: 'w1', recipientKeyFp: 'fp1' },
        update: { wrappedKey: 'w1', recipientKeyFp: 'fp1' },
      });
      expect(txPrisma.roomKeyGrant.upsert).toHaveBeenCalledWith({
        where: { roomId_userId_keyId: { roomId: 'room-1', userId: 'user-2', keyId: 1 } },
        create: { roomId: 'room-1', userId: 'user-2', keyId: 1, wrappedKey: 'w2', recipientKeyFp: 'fp2' },
        update: { wrappedKey: 'w2', recipientKeyFp: 'fp2' },
      });
      // ...and NEITHER happened on the outer, non-tx client — an
      // implementation that moved the conditional update (or the grant
      // upserts) outside $transaction would fail here even though it might
      // still "work" in a single-request test with no real concurrency.
      expect(mockPrisma.room.updateMany).not.toHaveBeenCalled();
      expect(mockPrisma.roomKeyGrant.upsert).not.toHaveBeenCalled();
      expect(result).toEqual({ currentKeyId: 1 });
    });

    it('a losing racer (expectedCurrentKeyId stale) gets ConflictException and its transaction rolls back — no grants inserted', async () => {
      mockPrisma.roomMember.findUnique.mockResolvedValue({ roomId: 'room-1', userId: 'admin-1', role: 'admin' });
      mockPrisma.roomMember.findMany.mockResolvedValue([{ userId: 'admin-1' }]);
      txPrisma.room.updateMany.mockResolvedValue({ count: 0 }); // someone else already claimed it

      await expect(
        service.uploadGrants('room-1', 'admin-1', {
          claimEpoch: { expectedCurrentKeyId: 0 },
          grants: [{ userId: 'admin-1', keyId: 1, wrappedKey: 'w1', recipientKeyFp: 'fp1' }],
        }),
      ).rejects.toThrow(ConflictException);
      expect(txPrisma.roomKeyGrant.upsert).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException when a claim\'s grants target anything other than the newly claimed epoch', async () => {
      mockPrisma.roomMember.findUnique.mockResolvedValue({ roomId: 'room-1', userId: 'admin-1', role: 'admin' });
      mockPrisma.roomMember.findMany.mockResolvedValue([{ userId: 'admin-1' }]);

      await expect(
        service.uploadGrants('room-1', 'admin-1', {
          claimEpoch: { expectedCurrentKeyId: 1 }, // claiming epoch 2...
          grants: [{ userId: 'admin-1', keyId: 1, wrappedKey: 'w1', recipientKeyFp: 'fp1' }], // ...but granting epoch 1
        }),
      ).rejects.toThrow(ForbiddenException);
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException when a claim grants a userId who is not a member of the room', async () => {
      mockPrisma.roomMember.findUnique.mockResolvedValue({ roomId: 'room-1', userId: 'admin-1', role: 'admin' });
      mockPrisma.roomMember.findMany.mockResolvedValue([{ userId: 'admin-1' }]);

      await expect(
        service.uploadGrants('room-1', 'admin-1', {
          claimEpoch: { expectedCurrentKeyId: 0 },
          grants: [{ userId: 'not-a-member', keyId: 1, wrappedKey: 'w1', recipientKeyFp: 'fp1' }],
        }),
      ).rejects.toThrow(ForbiddenException);
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('getMembersWithPublicKeys', () => {
    // Necessary for enablement (0->1): before any epoch exists, the admin
    // wrapping a brand-new room key needs every current member's published
    // publicKey to seal it for them — GET .../keys/pending is empty at
    // currentKeyId 0 (there is no "reached epoch" yet to be missing a grant
    // for), so it cannot serve this. Not explicitly named as its own
    // endpoint in ADR-010's Consequences count (3 endpoints) — flagged as a
    // filled implementation gap in the PR body.
    it('throws ForbiddenException when the requester is not a member', async () => {
      mockPrisma.roomMember.findUnique.mockResolvedValue(null);
      await expect(service.getMembersWithPublicKeys('room-1', 'outsider')).rejects.toThrow(ForbiddenException);
    });

    it('returns userId/publicKey only for members who have published a key', async () => {
      mockPrisma.roomMember.findUnique.mockResolvedValue({ roomId: 'room-1', userId: 'user-1', role: 'admin' });
      mockPrisma.roomMember.findMany.mockResolvedValue([
        { roomId: 'room-1', userId: 'user-1', role: 'admin', user: { id: 'user-1', publicKey: 'pk1', publicKeyFp: 'fp1' } },
        { roomId: 'room-1', userId: 'user-2', role: 'member', user: { id: 'user-2', publicKey: null, publicKeyFp: null } },
      ]);

      const result = await service.getMembersWithPublicKeys('room-1', 'user-1');

      expect(result).toEqual([{ userId: 'user-1', publicKey: 'pk1' }]);
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
