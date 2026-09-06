import { Injectable, NotFoundException, ForbiddenException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UploadKeysDto } from './dto/upload-keys.dto';

export interface PendingGrant {
  userId: string;
  keyId: number;
  publicKey: string;
}

export interface MemberPublicKey {
  userId: string;
  publicKey: string;
}

export interface RoomKeyGrantView {
  roomId: string;
  userId: string;
  keyId: number;
  wrappedKey: string;
  recipientKeyFp: string;
}

/**
 * ADR-010 key management: pending-grant discovery, grant upload (plain
 * first-responder serving and the atomic epoch claim), and a member's own
 * grant list. The server never wraps or unwraps a key — it only routes
 * ciphertext grants clients hand it.
 */
@Injectable()
export class RoomKeysService {
  constructor(private readonly prisma: PrismaService) {}

  async getPending(roomId: string, requesterId: string): Promise<PendingGrant[]> {
    const room = await this.prisma.room.findUnique({ where: { id: roomId } });
    if (!room) throw new NotFoundException(`Room "${roomId}" not found`);
    await this.assertMember(roomId, requesterId);

    if (room.currentKeyId === 0) return [];

    const [members, grants] = await Promise.all([
      this.prisma.roomMember.findMany({ where: { roomId }, include: { user: true } }),
      this.prisma.roomKeyGrant.findMany({ where: { roomId } }),
    ]);

    const pending: PendingGrant[] = [];
    for (const member of members) {
      const { user } = member as unknown as {
        user: { id: string; publicKey: string | null; publicKeyFp: string | null };
      };
      // Can't wrap a key for someone with no published public key yet.
      if (!user.publicKey || !user.publicKeyFp) continue;

      for (let keyId = 1; keyId <= room.currentKeyId; keyId++) {
        // Matched on recipientKeyFp = current publicKeyFp, not mere row
        // presence — a grant sealed to a since-replaced key must be
        // re-offered (ADR-010, Multi-device / reinstall).
        const hasCurrentGrant = grants.some(
          (g) => g.userId === member.userId && g.keyId === keyId && g.recipientKeyFp === user.publicKeyFp,
        );
        if (!hasCurrentGrant) {
          pending.push({ userId: member.userId, keyId, publicKey: user.publicKey });
        }
      }
    }
    return pending;
  }

  /**
   * Necessary for enablement (0->1): GET .../keys/pending is empty while
   * currentKeyId is 0 (there's no reached epoch yet to be missing a grant
   * for), so it can't supply the recipient public keys an admin needs to
   * wrap a brand-new room key for every current member. Not one of the
   * three endpoints ADR-010's Consequences section explicitly counts —
   * filled implementation gap, flagged in the PR body.
   */
  async getMembersWithPublicKeys(roomId: string, requesterId: string): Promise<MemberPublicKey[]> {
    await this.assertMember(roomId, requesterId);

    const members = await this.prisma.roomMember.findMany({ where: { roomId }, include: { user: true } });
    const result: MemberPublicKey[] = [];
    for (const member of members) {
      const { user } = member as unknown as { user: { id: string; publicKey: string | null } };
      if (user.publicKey) result.push({ userId: member.userId, publicKey: user.publicKey });
    }
    return result;
  }

  async getMyGrants(roomId: string, requesterId: string): Promise<RoomKeyGrantView[]> {
    await this.assertMember(roomId, requesterId);
    return this.prisma.roomKeyGrant.findMany({
      where: { roomId, userId: requesterId },
      orderBy: { keyId: 'asc' },
    });
  }

  async uploadGrants(
    roomId: string,
    actorId: string,
    dto: UploadKeysDto,
  ): Promise<{ currentKeyId: number }> {
    const actor = await this.assertMember(roomId, actorId);

    // Authorization on the grant targets themselves (code review round 1,
    // Important #3) — assertMember above only proves the UPLOADER is a
    // member; nothing previously stopped them from also naming an arbitrary
    // non-member userId as a grant RECIPIENT.
    if (dto.grants.length > 0) {
      const members = await this.prisma.roomMember.findMany({
        where: { roomId },
        select: { userId: true },
      });
      const memberIds = new Set(members.map((m) => m.userId));
      for (const g of dto.grants) {
        if (!memberIds.has(g.userId)) {
          throw new ForbiddenException(`Cannot grant a key to "${g.userId}" — not a member of this room`);
        }
      }
    }

    if (!dto.claimEpoch) {
      // First-responder pattern: any online member holding epoch(s) a
      // pending member needs can serve them — no admin gate here. Still
      // bounded to epochs that actually exist yet (code review round 1,
      // Important #3) — a non-admin has no legitimate reason to grant a
      // future epoch, since only the atomic claim below can ever create one.
      const room = await this.prisma.room.findUniqueOrThrow({ where: { id: roomId } });
      for (const g of dto.grants) {
        if (g.keyId > room.currentKeyId) {
          throw new ForbiddenException(
            `Cannot grant epoch ${g.keyId} — room's current epoch is ${room.currentKeyId}`,
          );
        }
      }
      await this.upsertGrants(this.prisma, roomId, dto.grants);
      return { currentKeyId: room.currentKeyId };
    }

    // Enablement (0->1) and every rotation thereafter: reviewer-flagged
    // residual from the ADR — require RoomMember.role === 'admin' for the
    // epoch-claim POST (rooms.service.ts sets the room creator admin).
    if (actor.role !== 'admin') {
      throw new ForbiddenException('Only a room admin can claim a key epoch');
    }

    const { expectedCurrentKeyId } = dto.claimEpoch;
    const claimedKeyId = expectedCurrentKeyId + 1;
    for (const g of dto.grants) {
      if (g.keyId !== claimedKeyId) {
        throw new ForbiddenException(
          `A claim's grants must all target the newly claimed epoch (${claimedKeyId}), got ${g.keyId}`,
        );
      }
    }

    return this.prisma.$transaction(async (tx) => {
      // Conditional increment + grant insert in one transaction: either
      // both commit or neither does, closing the orphan-epoch window a
      // two-step version would leave open (ADR-010, Rotation authority).
      const updated = await tx.room.updateMany({
        where: { id: roomId, currentKeyId: expectedCurrentKeyId },
        data: { currentKeyId: { increment: 1 } },
      });
      if (updated.count !== 1) {
        throw new ConflictException('Room key epoch has already advanced — retry with the current epoch');
      }
      await this.upsertGrants(tx, roomId, dto.grants);
      return { currentKeyId: claimedKeyId };
    });
  }

  /**
   * upsert, not createMany+skipDuplicates (code review round 1, Important
   * #2): the primary key is (roomId, userId, keyId), so a grant re-served
   * after the recipient's publicKeyFp was invalidated (reinstall — see
   * UsersService.setPublicKey deleting their old grants) lands on a
   * (roomId, userId, keyId) triple that can, in the ordinary course of
   * events, already be occupied by an unrelated still-valid row for a
   * DIFFERENT prior key — skipDuplicates silently dropped the re-serve
   * attempt instead of updating it, permanently stranding that member.
   * Each grant is independent, so per-row upsert (vs. a single bulk
   * statement Prisma's createMany supports but upsert doesn't) is fine here
   * — this path is never more than one room's worth of members per call.
   */
  private async upsertGrants(
    client: Pick<PrismaService, 'roomKeyGrant'>,
    roomId: string,
    grants: UploadKeysDto['grants'],
  ): Promise<void> {
    await Promise.all(
      grants.map((g) =>
        client.roomKeyGrant.upsert({
          where: { roomId_userId_keyId: { roomId, userId: g.userId, keyId: g.keyId } },
          create: { roomId, userId: g.userId, keyId: g.keyId, wrappedKey: g.wrappedKey, recipientKeyFp: g.recipientKeyFp },
          update: { wrappedKey: g.wrappedKey, recipientKeyFp: g.recipientKeyFp },
        }),
      ),
    );
  }

  private async assertMember(roomId: string, userId: string) {
    const member = await this.prisma.roomMember.findUnique({
      where: { roomId_userId: { roomId, userId } },
    });
    if (!member) throw new ForbiddenException('Not a member of this room');
    return member;
  }
}
