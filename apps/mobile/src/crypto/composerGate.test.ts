import { describe, it, expect } from 'bun:test';
import { isComposerReady, type EpochHoldingCipher } from './composerGate';

describe('isComposerReady (ADR-010 send-path gate, code review round 1 Critical #1)', () => {
  it('is always ready in a plaintext/disabled room (currentKeyId 0), even with no cipher', () => {
    expect(isComposerReady(0, null)).toBe(true);
  });

  // The exact regression this gate exists to prevent: a cipher-less engine
  // in an E2EE-enabled room must never be allowed to attempt a send — that
  // send blocks (throws) inside SyncEngine/LibsodiumContentCipher today,
  // uncaught, with no UI state and a lost draft (Critical #1 / #3).
  it('is NOT ready when the room is E2EE-enabled but no cipher exists yet', () => {
    expect(isComposerReady(1, null)).toBe(false);
  });

  it('is NOT ready when a cipher exists but has not loaded the current epoch key yet', () => {
    const cipher: EpochHoldingCipher = { hasKey: () => false };
    expect(isComposerReady(1, cipher)).toBe(false);
  });

  it('is ready once the cipher holds the room current epoch key', () => {
    const cipher: EpochHoldingCipher = { hasKey: (keyId) => keyId === 1 };
    expect(isComposerReady(1, cipher)).toBe(true);
  });

  it('is NOT ready after a rotation until the cipher holds the NEW current epoch (stale-key case)', () => {
    // Holds epoch 1 only; room has rotated to epoch 2.
    const cipher: EpochHoldingCipher = { hasKey: (keyId) => keyId === 1 };
    expect(isComposerReady(2, cipher)).toBe(false);
  });
});
