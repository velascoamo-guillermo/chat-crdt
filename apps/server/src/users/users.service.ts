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
   *
   * publicKeyFp is derived server-side as BLAKE2b-512 hex ('blake2b512',
   * unkeyed, 64-byte digest) rather than SHA-256. Deviation flagged: the ADR
   * says "a hash of it" without naming an algorithm; BLAKE2b was picked
   * because react-native-libsodium (this ADR's chosen mobile crypto library)
   * exposes crypto_generichash (BLAKE2b) but no plain SHA-256 primitive, and
   * the mobile client independently recomputes this exact fingerprint for
   * RoomKeyGrant.recipientKeyFp (the uploader supplies it verbatim — see
   * room-keys.service.ts) — both sides need a hash they can both compute,
   * and Node's crypto module can produce the identical BLAKE2b-512 digest
   * via 'blake2b512' for the server-side comparison in
   * RoomKeysService.getPending to line up bit-for-bit.
   *
   * Republishing (reinstall / new device) deletes every RoomKeyGrant row
   * this user held — they're ciphertext sealed to a now-dead private key,
   * permanently unusable — in the same transaction as the key update, which
   * puts every one of this user's (room, epoch) pairs back into
   * GET /rooms/:id/keys/pending automatically (Multi-device / reinstall,
   * ADR-010).
   */
  async setPublicKey(userId: string, publicKey: string): Promise<PublicKeyResult> {
    const publicKeyFp = createHash('blake2b512').update(publicKey).digest('hex');

    await this.prisma.$transaction([
      this.prisma.roomKeyGrant.deleteMany({ where: { userId } }),
      this.prisma.user.update({ where: { id: userId }, data: { publicKey, publicKeyFp } }),
    ]);

    return { publicKey, publicKeyFp };
  }
}
