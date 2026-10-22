import * as Y from 'yjs';

/**
 * ADR-010 wire format: an encrypted message's `content` is
 * 'E2E1' + JSON.stringify({ v: 1, keyId, nonce, ciphertext }) (see
 * apps/mobile/src/crypto/e2eeEnvelope.ts). The server never decrypts it, but
 * it does check the envelope's exact shape: a bare prefix would let a stale
 * client's "E2E1 …" prose through as if it were ciphertext, and extra keys
 * or readable short "ciphertext" would be side channels. A malicious client
 * can still encode text as valid-looking base64url — format checks can't
 * stop that; the client gate is the primary defense.
 */
const E2EE_PREFIX = 'E2E1';
// The app's react-native-libsodium emits nonce and ciphertext as
// URLSAFE_NO_PADDING base64 (its 'base64' output format and to_base64 default).
const BASE64URL = /^[A-Za-z0-9_-]+$/;
// XChaCha20-Poly1305: 24-byte nonce -> 32 chars.
const NONCE_CHARS = 32;
// Ciphertext = plaintext + 16-byte tag. Plaintext is 1..MAX_MESSAGE_LENGTH
// (4000) UTF-16 chars, <= 16000 UTF-8 bytes: 17..16016 bytes -> 23..21355 chars.
const MIN_CIPHERTEXT_CHARS = 23;
const MAX_CIPHERTEXT_CHARS = 21_355;
const ENVELOPE_KEYS = ['ciphertext', 'keyId', 'nonce', 'v'];
// MessageDto (packages/shared): nothing readable may ride beside `content`.
const MESSAGE_KEYS = ['content', 'createdAt', 'id', 'roomId', 'userId', 'username'];

export type EnvelopeGateResult =
  | { ok: true }
  /** Ids of the offending message objects, so the client can retract them. */
  | { ok: false; rejectedMessageIds: string[] };

/**
 * T10 defense in depth: in an E2EE-enabled room, is every message this Yjs
 * update inserts a well-formed E2E1 envelope?
 *
 * Decodes the update's structs (O(update size), no doc copy) instead of
 * applying it to a scratch doc. Parent info is omitted on the wire for items
 * appended after existing ones, so this doesn't try to resolve which root an
 * item belongs to: the room doc only ever holds the `messages` array of
 * plain MessageDto objects, so EVERY inserted item must be ContentAny whose
 * elements are message objects with an enveloped `content`. Anything else
 * (strings, nested Y types, JSON/embed/binary content) is rejected — no
 * honest client produces it, and it could smuggle message-shaped plaintext.
 * Deletes and GC'd/skipped ranges carry no content and pass — which is also
 * how a client recovers: once it deletes its rejected items, its next step2
 * carries them as content-less ContentDeleted/GC structs. A malformed update
 * is rejected rather than thrown.
 */
export function checkEnvelopedUpdate(update: Uint8Array): EnvelopeGateResult {
  let structs: Array<Y.Item | Y.GC | Y.Skip>;
  try {
    ({ structs } = Y.decodeUpdate(update));
  } catch {
    return { ok: false, rejectedMessageIds: [] };
  }
  let ok = true;
  const rejectedMessageIds: string[] = [];
  for (const struct of structs) {
    if (!(struct instanceof Y.Item)) continue; // GC / Skip: no content
    const content = struct.content;
    if (content instanceof Y.ContentDeleted) continue;
    if (!(content instanceof Y.ContentAny)) {
      ok = false;
      continue;
    }
    for (const value of content.getContent()) {
      if (isEnvelopedMessage(value)) continue;
      ok = false;
      const id = (value as { id?: unknown } | null)?.id;
      if (typeof id === 'string') rejectedMessageIds.push(id);
    }
  }
  return ok ? { ok: true } : { ok: false, rejectedMessageIds };
}

function hasExactKeys(value: object, keys: readonly string[]): boolean {
  const own = Object.keys(value).sort();
  return own.length === keys.length && own.every((k, i) => k === keys[i]);
}

function isEnvelopedMessage(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  if (!hasExactKeys(value, MESSAGE_KEYS)) return false;
  const content = (value as { content?: unknown }).content;
  return typeof content === 'string' && isWellFormedEnvelope(content);
}

function isBase64Url(value: unknown, minChars: number, maxChars: number): boolean {
  return (
    typeof value === 'string' &&
    value.length >= minChars &&
    value.length <= maxChars &&
    value.length % 4 !== 1 && // impossible length for unpadded base64
    BASE64URL.test(value)
  );
}

function isWellFormedEnvelope(content: string): boolean {
  if (!content.startsWith(E2EE_PREFIX)) return false;
  let envelope: unknown;
  try {
    envelope = JSON.parse(content.slice(E2EE_PREFIX.length));
  } catch {
    return false;
  }
  if (typeof envelope !== 'object' || envelope === null || Array.isArray(envelope)) return false;
  if (!hasExactKeys(envelope, ENVELOPE_KEYS)) return false;
  const { v, keyId, nonce, ciphertext } = envelope as Record<string, unknown>;
  return (
    v === 1 &&
    typeof keyId === 'number' &&
    Number.isInteger(keyId) &&
    keyId > 0 &&
    isBase64Url(nonce, NONCE_CHARS, NONCE_CHARS) &&
    isBase64Url(ciphertext, MIN_CIPHERTEXT_CHARS, MAX_CIPHERTEXT_CHARS)
  );
}
