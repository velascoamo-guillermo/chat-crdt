import { describe, it, expect } from 'bun:test';
import { isComposerReady, type EpochHoldingCipher } from './composerGate';

describe('isComposerReady (ADR-010 send-path gate, code review round 1 Critical #1)', () => {
  it('is always ready in a confirmed plaintext room (currentKeyId 0), even with no cipher', () => {
    expect(isComposerReady('plaintext', 0, null)).toBe(true);
  });

  // T10: a stale cached currentKeyId of 0 is NOT proof the room is plaintext.
  // Until the per-entry refresh confirms it, the composer stays gated.
  it('is NOT ready while the room E2EE state is unknown, even with currentKeyId 0', () => {
    expect(isComposerReady('unknown', 0, null)).toBe(false);
  });

  it('is NOT ready while unknown even if some cipher holds a key', () => {
    const cipher: EpochHoldingCipher = { hasKey: () => true };
    expect(isComposerReady('unknown', 1, cipher)).toBe(false);
  });

  // The exact regression this gate exists to prevent: a cipher-less engine
  // in an E2EE-enabled room must never be allowed to attempt a send — that
  // send blocks (throws) inside SyncEngine/LibsodiumContentCipher today,
  // uncaught, with no UI state and a lost draft (Critical #1 / #3).
  it('is NOT ready when the room is E2EE-enabled but no cipher exists yet', () => {
    expect(isComposerReady('e2ee', 1, null)).toBe(false);
  });

  // T10: E2EE by the sticky flag while the summary still says 0 — there is
  // no epoch to hold a key for, so never fall back to a plaintext send.
  it('is NOT ready for an E2EE room whose summary still reads currentKeyId 0', () => {
    const cipher: EpochHoldingCipher = { hasKey: () => true };
    expect(isComposerReady('e2ee', 0, cipher)).toBe(false);
  });

  it('is NOT ready when a cipher exists but has not loaded the current epoch key yet', () => {
    const cipher: EpochHoldingCipher = { hasKey: () => false };
    expect(isComposerReady('e2ee', 1, cipher)).toBe(false);
  });

  it('is ready once the cipher holds the room current epoch key', () => {
    const cipher: EpochHoldingCipher = { hasKey: (keyId) => keyId === 1 };
    expect(isComposerReady('e2ee', 1, cipher)).toBe(true);
  });

  it('is NOT ready after a rotation until the cipher holds the NEW current epoch (stale-key case)', () => {
    // Holds epoch 1 only; room has rotated to epoch 2.
    const cipher: EpochHoldingCipher = { hasKey: (keyId) => keyId === 1 };
    expect(isComposerReady('e2ee', 2, cipher)).toBe(false);
  });
});
