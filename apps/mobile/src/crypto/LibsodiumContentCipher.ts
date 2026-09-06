import sodium from 'react-native-libsodium';
import type { ContentCipher, MessageAad } from '@chat-crdt/sync-engine';
import { buildEnvelope, parseEnvelope } from './e2eeEnvelope';

const NONCE_BYTES = 24;

/**
 * ADR-010 mobile impl of the injected ContentCipher — the only place in the
 * app that touches key material (sync-engine itself stays crypto-agnostic,
 * ADR-005). `encrypt`/`decrypt` must stay SYNCHRONOUS (SyncEngine.sendMessage
 * is synchronous), so unwrapped room keys are loaded into this in-memory
 * cache ahead of time (setKey, called from keyFlows after unwrapping a grant
 * fetched from expo-secure-store or the server) rather than looked up from
 * async storage on every call.
 *
 * One instance per room (constructed alongside that room's SyncEngine in
 * useSync.ts) — the ADR itself notes contentCipher is fixed at SyncEngine
 * construction, so enabling E2EE mid-session means re-creating the engine.
 */
export class LibsodiumContentCipher implements ContentCipher {
  private readonly keysByEpoch = new Map<number, Uint8Array>();
  private currentKeyId: number | null = null;
  // The room's actual current epoch per the server (RoomSummary.currentKeyId
  // / Room.currentKeyId), set externally by useE2eeCipher whenever it
  // changes. Distinct from `currentKeyId` above (the highest epoch THIS
  // cipher happens to have a key loaded for): without this check, a device
  // that hasn't yet been served a just-rotated epoch's grant would silently
  // keep encrypting new messages under its last-known (now stale) key —
  // code review round 1, Important #1.
  private expectedCurrentEpoch: number | null = null;

  /** Registers an unwrapped room key for an epoch. Highest keyId wins as "current". */
  setKey(keyId: number, key: Uint8Array): void {
    this.keysByEpoch.set(keyId, key);
    if (this.currentKeyId === null || keyId > this.currentKeyId) {
      this.currentKeyId = keyId;
    }
  }

  hasKey(keyId: number): boolean {
    return this.keysByEpoch.has(keyId);
  }

  /** The room's actual current epoch, per the server — see field doc above. */
  setExpectedCurrentEpoch(keyId: number): void {
    this.expectedCurrentEpoch = keyId;
  }

  encrypt(plaintext: string, ad: MessageAad): string {
    if (this.currentKeyId === null) {
      // ADR-010, "Send path without a current epoch key": never fall back
      // to plaintext, never encrypt under a stale epoch — block instead.
      throw new Error('e2ee: no current-epoch key cached for this room yet');
    }
    if (this.expectedCurrentEpoch !== null && this.currentKeyId !== this.expectedCurrentEpoch) {
      // We hold SOME key, but not the room's actual current one — e.g. the
      // room rotated to epoch 2 and this device hasn't been served that
      // grant yet, while it still holds epoch 1. Encrypting under epoch 1
      // now would be silently readable-by-nobody-who-matters (members who
      // dropped the superseded key) rather than a hard, visible failure.
      throw new Error(
        `e2ee: stale epoch — holds key ${this.currentKeyId}, room is at ${this.expectedCurrentEpoch}`
      );
    }
    const key = this.keysByEpoch.get(this.currentKeyId);
    if (!key) {
      throw new Error('e2ee: no current-epoch key cached for this room yet');
    }

    const nonce = sodium.randombytes_buf(NONCE_BYTES);
    // AAD key order MUST match the reconstruction in decrypt/decryptForRender
    // — JSON.stringify is used as the wire form for additional_data, and its
    // key order depends on object literal insertion order, not a canonical
    // sort. SyncEngine.ts builds this same {id, roomId, userId, username,
    // createdAt} literal for encrypt; keep both in lockstep.
    const adJson = adToJson(ad);
    const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
      plaintext,
      adJson,
      null,
      nonce,
      key,
      'base64'
    );
    return buildEnvelope(this.currentKeyId, sodium.to_base64(nonce), ciphertext);
  }

  decrypt(content: string, ad: MessageAad): string {
    const envelope = parseEnvelope(content);
    if (!envelope) return content; // no prefix — legacy plaintext

    const key = this.keysByEpoch.get(envelope.keyId);
    if (!key) {
      throw new Error(`e2ee: no key cached for epoch ${envelope.keyId}`);
    }

    const nonce = sodium.from_base64(envelope.nonce);
    const ciphertext = sodium.from_base64(envelope.ciphertext);
    const adJson = adToJson(ad);
    const plaintextBytes = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
      null,
      ciphertext,
      adJson,
      nonce,
      key
    );
    return sodium.to_string(plaintextBytes);
  }
}

function adToJson(ad: MessageAad): string {
  return JSON.stringify({
    id: ad.id,
    roomId: ad.roomId,
    userId: ad.userId,
    username: ad.username,
    createdAt: ad.createdAt,
  });
}
