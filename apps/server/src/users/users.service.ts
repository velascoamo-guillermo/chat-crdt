import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';

export interface PublicKeyResult {
  publicKey: string;
  publicKeyFp: string;
}

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * ADR-010: publishes (or republishes) this user's X25519 public key.
   * publicKeyFp is derived server-side (sha256 hex of publicKey) — unlike
   * RoomKeyGrant.recipientKeyFp, which the uploader supplies verbatim, this
   * fingerprint has no race to protect against since it's just a stable
   * hash of the value being written in the same call.
   *
   * Republishing (reinstall / new device) deletes every RoomKeyGrant row
   * this user held — they're ciphertext sealed to a now-dead private key,
   * permanently unusable — in the same transaction as the key update, which
   * puts every one of this user's (room, epoch) pairs back into
   * GET /rooms/:id/keys/pending automatically (Multi-device / reinstall,
   * ADR-010).
   */
  async setPublicKey(userId: string, publicKey: string): Promise<PublicKeyResult> {
    const publicKeyFp = createHash('sha256').update(publicKey).digest('hex');

    await this.prisma.$transaction([
      this.prisma.roomKeyGrant.deleteMany({ where: { userId } }),
      this.prisma.user.update({ where: { id: userId }, data: { publicKey, publicKeyFp } }),
    ]);

    return { publicKey, publicKeyFp };
  }
}
