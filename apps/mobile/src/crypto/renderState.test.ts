import { describe, it, expect } from 'bun:test';
import { resolveMessageRenderState, type DecryptCapableCipher, type PendingLookup } from './renderState';
import type { MessageDto } from '@chat-crdt/shared';
import { buildEnvelope, E2EE_PREFIX } from './e2eeEnvelope';

function makeMessage(overrides: Partial<MessageDto> = {}): MessageDto {
  return {
    id: 'msg-1',
    roomId: 'room-1',
    userId: 'user-1',
    username: 'alice',
    content: 'hello',
    createdAt: 1000,
    ...overrides,
  };
}

const NO_PENDING: PendingLookup = { hasPendingGrantFor: () => false };
const ALWAYS_PENDING: PendingLookup = { hasPendingGrantFor: () => true };

describe('resolveMessageRenderState (ADR-010 Rendering)', () => {
  it('renders legacy plaintext as-is when content has no E2E1 prefix', () => {
    const message = makeMessage({ content: 'plain text message' });
    const state = resolveMessageRenderState(message, null, NO_PENDING, true);
    expect(state).toEqual({ type: 'plaintext', text: 'plain text message' });
  });

  it('decrypts when a cipher is present and holds the message epoch key', () => {
    const message = makeMessage({ content: buildEnvelope(1, 'n', 'c') });
    const cipher: DecryptCapableCipher = {
      hasKey: (keyId) => keyId === 1,
      decrypt: () => 'decrypted text',
    };
    const state = resolveMessageRenderState(message, cipher, NO_PENDING, true);
    expect(state).toEqual({ type: 'decrypted', text: 'decrypted text' });
  });

  it('renders "waiting for encryption key" when no cipher/key yet but a pending grant exists for this epoch (fresh join / reinstall)', () => {
    const message = makeMessage({ content: buildEnvelope(1, 'n', 'c') });
    const state = resolveMessageRenderState(message, null, ALWAYS_PENDING, true);
    expect(state).toEqual({ type: 'waiting-for-key' });
  });

  it('renders "key unavailable" when no cipher/key and no pending grant exists (epoch predates this client, nobody will serve it)', () => {
    const message = makeMessage({ content: buildEnvelope(1, 'n', 'c') });
    const state = resolveMessageRenderState(message, null, NO_PENDING, true);
    expect(state).toEqual({ type: 'key-unavailable' });
  });

  it('renders "key unavailable" (not a crash) when decrypt throws — AD/key mismatch or a tampered envelope', () => {
    const message = makeMessage({ content: buildEnvelope(1, 'n', 'c') });
    const cipher: DecryptCapableCipher = {
      hasKey: () => true,
      decrypt: () => {
        throw new Error('AEAD authentication failed');
      },
    };
    const state = resolveMessageRenderState(message, cipher, NO_PENDING, true);
    expect(state).toEqual({ type: 'key-unavailable' });
  });

  it('renders "key unavailable" when a cipher exists but lacks this specific epoch, and nothing is pending for it', () => {
    const message = makeMessage({ content: buildEnvelope(2, 'n', 'c') });
    const cipher: DecryptCapableCipher = {
      hasKey: (keyId) => keyId === 1, // only holds epoch 1, not 2
      decrypt: () => 'unused',
    };
    const state = resolveMessageRenderState(message, cipher, NO_PENDING, true);
    expect(state).toEqual({ type: 'key-unavailable' });
  });

  // --- CRITICAL 2 regression coverage (code review round 1) ---------------
  // A user can simply TYPE the literal string "E2E1{...}" as an ordinary
  // chat message. parseEnvelope's JSON.parse throws on anything after the
  // prefix that isn't valid envelope JSON, and that throw used to happen
  // OUTSIDE any try/catch in resolveMessageRenderState — one such message
  // made the entire room (FlashList renders every row) permanently
  // unopenable. The fix must be total: never throw, in either room type.

  it('renders a literal typed "E2E1{...}" collision as plaintext in a plaintext/disabled room (never throws)', () => {
    const message = makeMessage({ content: `${E2EE_PREFIX}{not valid json at all` });
    expect(() => resolveMessageRenderState(message, null, NO_PENDING, false)).not.toThrow();
    const state = resolveMessageRenderState(message, null, NO_PENDING, false);
    // The room was never encrypted, so there is no legitimate envelope to
    // fail to parse — render the raw text exactly as any other plaintext.
    expect(state).toEqual({ type: 'plaintext', text: `${E2EE_PREFIX}{not valid json at all` });
  });

  it('renders a literal typed "E2E1{...}" collision as key-unavailable in an E2EE-enabled room (never throws)', () => {
    const message = makeMessage({ content: `${E2EE_PREFIX}{not valid json at all` });
    expect(() => resolveMessageRenderState(message, null, NO_PENDING, true)).not.toThrow();
    const state = resolveMessageRenderState(message, null, NO_PENDING, true);
    // Here it's genuinely ambiguous (real corrupted envelope vs. a coincidental
    // typed collision) — the safe default is the same "can't read this" state
    // already used for a tampered/undecryptable envelope, not a crash.
    expect(state).toEqual({ type: 'key-unavailable' });
  });

  it('renders pre-enablement legacy plaintext history as plaintext even in a now-E2EE-enabled room', () => {
    // A message sent before the room was enabled has ordinary content with
    // no E2E1 prefix at all — parseEnvelope correctly returns null for it
    // regardless of the room's current E2EE status.
    const message = makeMessage({ content: 'sent before enablement' });
    const state = resolveMessageRenderState(message, null, NO_PENDING, true);
    expect(state).toEqual({ type: 'plaintext', text: 'sent before enablement' });
  });
});
