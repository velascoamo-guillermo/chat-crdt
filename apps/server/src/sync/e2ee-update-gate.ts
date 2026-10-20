import * as Y from 'yjs';

/**
 * ADR-010 wire format: an encrypted message's `content` is
 * 'E2E1' + JSON.stringify(envelope) (see apps/mobile/src/crypto/e2eeEnvelope.ts).
 * The server never parses or decrypts the envelope — the prefix is all it
 * can (and needs to) check.
 */
const E2EE_PREFIX = 'E2E1';

/**
 * T10 defense in depth: in an E2EE-enabled room, is every message this Yjs
 * update inserts an E2E1 envelope?
 *
 * Decodes the update's structs (O(update size), no doc copy) instead of
 * applying it to a scratch doc. Parent info is omitted on the wire for items
 * appended after existing ones, so this doesn't try to resolve which root an
 * item belongs to: the room doc only ever holds the `messages` array of
 * plain MessageDto objects, so EVERY inserted item must be ContentAny whose
 * elements are message objects with an enveloped `content`. Anything else
 * (strings, nested Y types, JSON/embed/binary content) is rejected — no
 * honest client produces it, and it could smuggle message-shaped plaintext.
 * Deletes and GC'd/skipped ranges carry no content and pass. A malformed
 * update is rejected rather than thrown.
 */
export function isEnvelopedOnlyUpdate(update: Uint8Array): boolean {
  let structs: Array<Y.Item | Y.GC | Y.Skip>;
  try {
    ({ structs } = Y.decodeUpdate(update));
  } catch {
    return false;
  }
  for (const struct of structs) {
    if (!(struct instanceof Y.Item)) continue; // GC / Skip: no content
    const content = struct.content;
    if (content instanceof Y.ContentDeleted) continue;
    if (!(content instanceof Y.ContentAny)) return false;
    if (!content.getContent().every(isEnvelopedMessage)) return false;
  }
  return true;
}

function isEnvelopedMessage(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const content = (value as { content?: unknown }).content;
  return typeof content === 'string' && content.startsWith(E2EE_PREFIX);
}
