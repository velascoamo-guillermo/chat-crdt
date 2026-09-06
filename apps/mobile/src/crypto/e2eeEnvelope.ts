/**
 * ADR-010 wire format helpers — pure, no crypto/native dependency, so they
 * can be unit-tested outside the RN/Hermes runtime (react-native-libsodium
 * is JSI-native and only runs on-device; see LibsodiumContentCipher for the
 * part of this module that does depend on it).
 *
 * content = 'E2E1' + JSON.stringify(envelope)
 */
export const E2EE_PREFIX = 'E2E1';

export interface E2eeEnvelope {
  v: 1;
  /** Epoch this message is encrypted under. */
  keyId: number;
  /** base64, 24 random bytes — the AEAD nonce. */
  nonce: string;
  /** base64 — includes the 16-byte Poly1305 tag. */
  ciphertext: string;
}

export function buildEnvelope(keyId: number, nonce: string, ciphertext: string): string {
  const envelope: E2eeEnvelope = { v: 1, keyId, nonce, ciphertext };
  return `${E2EE_PREFIX}${JSON.stringify(envelope)}`;
}

/**
 * No prefix -> legacy plaintext / E2EE-disabled room: returns null, caller
 * renders `content` as-is (ADR-010, Wire format / Rendering).
 */
export function parseEnvelope(content: string): E2eeEnvelope | null {
  if (!content.startsWith(E2EE_PREFIX)) return null;
  const raw = content.slice(E2EE_PREFIX.length);
  const parsed: unknown = JSON.parse(raw);
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    (parsed as { v?: unknown }).v !== 1 ||
    typeof (parsed as { keyId?: unknown }).keyId !== 'number' ||
    typeof (parsed as { nonce?: unknown }).nonce !== 'string' ||
    typeof (parsed as { ciphertext?: unknown }).ciphertext !== 'string'
  ) {
    throw new Error('Malformed E2EE envelope');
  }
  return parsed as E2eeEnvelope;
}
