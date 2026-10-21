import * as Y from 'yjs';

/**
 * ADR-010 wire format: an encrypted message's `content` is
 * 'E2E1' + JSON.stringify({ v: 1, keyId, nonce, ciphertext }) (see
 * apps/mobile/src/crypto/e2eeEnvelope.ts). The server never decrypts it, but
 * it does check the envelope's shape: a bare prefix would let a stale client's
 * "E2E1 …" prose (or a malicious one's) through as if it were ciphertext.
 */
const E2EE_PREFIX = 'E2E1';
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

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

function isEnvelopedMessage(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const content = (value as { content?: unknown }).content;
  return typeof content === 'string' && isWellFormedEnvelope(content);
}

function isWellFormedEnvelope(content: string): boolean {
  if (!content.startsWith(E2EE_PREFIX)) return false;
  let envelope: unknown;
  try {
    envelope = JSON.parse(content.slice(E2EE_PREFIX.length));
  } catch {
    return false;
  }
  if (typeof envelope !== 'object' || envelope === null) return false;
  const { v, keyId, nonce, ciphertext } = envelope as Record<string, unknown>;
  return (
    v === 1 &&
    typeof keyId === 'number' &&
    Number.isInteger(keyId) &&
    keyId > 0 &&
    typeof nonce === 'string' &&
    BASE64.test(nonce) &&
    typeof ciphertext === 'string' &&
    BASE64.test(ciphertext)
  );
}
