import { describe, it, expect } from 'bun:test';
import { buildEnvelope, parseEnvelope, E2EE_PREFIX } from './e2eeEnvelope';

describe('e2eeEnvelope (ADR-010 wire format)', () => {
  it('builds an envelope with the E2E1 discriminator prefix', () => {
    const content = buildEnvelope(1, 'nonce-b64', 'ciphertext-b64');
    expect(content.startsWith(E2EE_PREFIX)).toBe(true);
  });

  it('round-trips keyId/nonce/ciphertext through build -> parse', () => {
    const content = buildEnvelope(3, 'abc123', 'def456');
    const envelope = parseEnvelope(content);
    expect(envelope).toEqual({ v: 1, keyId: 3, nonce: 'abc123', ciphertext: 'def456' });
  });

  it('returns null for content with no E2E1 prefix (legacy plaintext)', () => {
    expect(parseEnvelope('just a plain message')).toBeNull();
    expect(parseEnvelope('')).toBeNull();
  });

  it('throws on a prefixed but malformed envelope rather than silently misrendering', () => {
    expect(() => parseEnvelope(`${E2EE_PREFIX}not json`)).toThrow();
    expect(() => parseEnvelope(`${E2EE_PREFIX}${JSON.stringify({ v: 1 })}`)).toThrow();
  });
});
