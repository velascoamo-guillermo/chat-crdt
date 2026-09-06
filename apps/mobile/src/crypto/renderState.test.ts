import { describe, it, expect } from 'bun:test';
import { resolveMessageRenderState, type DecryptCapableCipher, type PendingLookup } from './renderState';
import type { MessageDto } from '@chat-crdt/shared';
import { buildEnvelope } from './e2eeEnvelope';

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
    const state = resolveMessageRenderState(message, null, NO_PENDING);
    expect(state).toEqual({ type: 'plaintext', text: 'plain text message' });
  });

  it('decrypts when a cipher is present and holds the message epoch key', () => {
    const message = makeMessage({ content: buildEnvelope(1, 'n', 'c') });
    const cipher: DecryptCapableCipher = {
      hasKey: (keyId) => keyId === 1,
      decrypt: () => 'decrypted text',
    };
    const state = resolveMessageRenderState(message, cipher, NO_PENDING);
    expect(state).toEqual({ type: 'decrypted', text: 'decrypted text' });
  });

  it('renders "waiting for encryption key" when no cipher/key yet but a pending grant exists for this epoch (fresh join / reinstall)', () => {
    const message = makeMessage({ content: buildEnvelope(1, 'n', 'c') });
    const state = resolveMessageRenderState(message, null, ALWAYS_PENDING);
    expect(state).toEqual({ type: 'waiting-for-key' });
  });

  it('renders "key unavailable" when no cipher/key and no pending grant exists (epoch predates this client, nobody will serve it)', () => {
    const message = makeMessage({ content: buildEnvelope(1, 'n', 'c') });
    const state = resolveMessageRenderState(message, null, NO_PENDING);
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
    const state = resolveMessageRenderState(message, cipher, NO_PENDING);
    expect(state).toEqual({ type: 'key-unavailable' });
  });

  it('renders "key unavailable" when a cipher exists but lacks this specific epoch, and nothing is pending for it', () => {
    const message = makeMessage({ content: buildEnvelope(2, 'n', 'c') });
    const cipher: DecryptCapableCipher = {
      hasKey: (keyId) => keyId === 1, // only holds epoch 1, not 2
      decrypt: () => 'unused',
    };
    const state = resolveMessageRenderState(message, cipher, NO_PENDING);
    expect(state).toEqual({ type: 'key-unavailable' });
  });
});
