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

  encrypt(plaintext: string, ad: MessageAad): string {
    if (this.currentKeyId === null) {
      // ADR-010, "Send path without a current epoch key": never fall back
      // to plaintext, never encrypt under a stale epoch — block instead.
      throw new Error('e2ee: no current-epoch key cached for this room yet');
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
