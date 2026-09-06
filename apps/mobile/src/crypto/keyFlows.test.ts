import { describe, it, expect, mock, beforeEach } from 'bun:test';
import { createHash } from 'node:crypto';
import { RoomKeyStore, type SecureKeyValueStore } from './keyStore';

// react-native-libsodium is JSI-native and unavailable under bun test (see
// e2eeEnvelope.ts's module doc comment) — mocked here with the minimal
// surface keyFlows.ts actually calls, so its OWN logic (ordering,
// per-grant error isolation) can run for real outside the RN/Hermes
// runtime. This must be registered before keyFlows.ts is first imported
// (dynamic import below), since ES module imports are cached per module URL.
let sealShouldThrowForKeyId: number | null = null;

mock.module('react-native-libsodium', () => ({
  default: {
    crypto_box_keypair: (_format: string) => ({ publicKey: 'device-pub', privateKey: 'device-priv' }),
    from_base64: (s: string) => new TextEncoder().encode(s),
    to_base64: (b: Uint8Array) => new TextDecoder().decode(b),
    crypto_box_seal: (_msg: Uint8Array, _pk: Uint8Array, _fmt: string) => 'sealed',
    crypto_box_seal_open: (wrapped: Uint8Array, _pk: Uint8Array, _sk: Uint8Array) => {
      const label = new TextDecoder().decode(wrapped);
      if (sealShouldThrowForKeyId !== null && label === `wrapped-for-epoch-${sealShouldThrowForKeyId}`) {
        throw new Error('crypto_box_seal_open: corrupted ciphertext');
      }
      return new TextEncoder().encode(label);
    },
    // Real BLAKE2b-512 (Node's), not a stub — see the pin test below (code
    // review round 1, Important #8). react-native-libsodium's own native
    // crypto_generichash can't run under bun test at all (JSI-native), so
    // this can't prove libsodium's implementation independently agrees with
    // Node's; it DOES pin publicKeyFp.ts's calling contract (arg order,
    // output length/format) against a hardcoded expected digest, and was
    // cross-checked live on-device in this ticket's manual verification
    // pass (the server-derived fingerprint from a real device's real
    // crypto_generichash call matched and correctly round-tripped a grant).
    crypto_generichash: (_len: number, data: string, _key: null, outputFormat: string) => {
      if (outputFormat !== 'hex') throw new Error('mock only supports hex output');
      return createHash('blake2b512').update(data).digest('hex');
    },
  },
}));

const { ensureIdentityPublished, fetchAndLoadMyGrants } = await import('./keyFlows');
const { computePublicKeyFp } = await import('./publicKeyFp');

function memoryBackend(): SecureKeyValueStore {
  const map = new Map<string, string>();
  return {
    getItem: async (key) => map.get(key) ?? null,
    setItem: async (key, value) => {
      map.set(key, value);
    },
    removeItem: async (key) => {
      map.delete(key);
    },
  };
}

const CTX = { apiBase: 'http://test.local', token: 'tok' };

describe('ensureIdentityPublished (code review round 1, Important #5)', () => {
  beforeEach(() => {
    sealShouldThrowForKeyId = null;
  });

  it('does not persist the local identity when the publish PUT fails', async () => {
    const keyStore = new RoomKeyStore(memoryBackend());
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify({ message: 'server down' }), { status: 500 })) as unknown as typeof fetch;

    await expect(ensureIdentityPublished(CTX, keyStore)).rejects.toThrow();
    expect(await keyStore.getIdentity()).toBeNull();

    globalThis.fetch = originalFetch;
  });

  it('retries with a fresh publish attempt on the next call after a failure (no stuck stored-but-unpublished state)', async () => {
    const keyStore = new RoomKeyStore(memoryBackend());
    let calls = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      calls++;
      if (calls === 1) return new Response(JSON.stringify({ message: 'server down' }), { status: 500 });
      return new Response(JSON.stringify({ publicKey: 'device-pub', publicKeyFp: 'fp' }), { status: 200 });
    }) as unknown as typeof fetch;

    await expect(ensureIdentityPublished(CTX, keyStore)).rejects.toThrow();
    await ensureIdentityPublished(CTX, keyStore); // succeeds this time

    expect(calls).toBe(2); // proves the second call actually retried the PUT, not a no-op
    expect(await keyStore.getIdentity()).toEqual({ publicKey: 'device-pub', privateKey: 'device-priv' });

    globalThis.fetch = originalFetch;
  });

  it('persists the identity only after the PUT succeeds', async () => {
    const keyStore = new RoomKeyStore(memoryBackend());
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify({ publicKey: 'device-pub', publicKeyFp: 'fp' }), { status: 200 })) as unknown as typeof fetch;

    await ensureIdentityPublished(CTX, keyStore);

    expect(await keyStore.getIdentity()).toEqual({ publicKey: 'device-pub', privateKey: 'device-priv' });
    globalThis.fetch = originalFetch;
  });
});

describe('fetchAndLoadMyGrants (code review round 1, Important #4)', () => {
  beforeEach(() => {
    sealShouldThrowForKeyId = null;
  });

  it('loads every other epoch even when one grant row is corrupted (per-grant isolation)', async () => {
    const keyStore = new RoomKeyStore(memoryBackend());
    await keyStore.setIdentity({ publicKey: 'device-pub', privateKey: 'device-priv' });
    sealShouldThrowForKeyId = 2; // epoch 2's grant is corrupted

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify([
          { roomId: 'r1', userId: 'u1', keyId: 1, wrappedKey: 'wrapped-for-epoch-1', recipientKeyFp: 'fp' },
          { roomId: 'r1', userId: 'u1', keyId: 2, wrappedKey: 'wrapped-for-epoch-2', recipientKeyFp: 'fp' },
          { roomId: 'r1', userId: 'u1', keyId: 3, wrappedKey: 'wrapped-for-epoch-3', recipientKeyFp: 'fp' },
        ]),
        { status: 200 }
      )) as unknown as typeof fetch;

    const setKeyCalls: number[] = [];
    const cipher = { setKey: (keyId: number) => setKeyCalls.push(keyId) };

    await expect(fetchAndLoadMyGrants(CTX, 'r1', keyStore, cipher as never)).resolves.toBeUndefined();

    // Epoch 2 (the corrupted one) is skipped; 1 and 3 still land.
    expect(setKeyCalls.sort()).toEqual([1, 3]);
    expect(await keyStore.getRoomKey('r1', 1)).not.toBeNull();
    expect(await keyStore.getRoomKey('r1', 2)).toBeNull();
    expect(await keyStore.getRoomKey('r1', 3)).not.toBeNull();

    globalThis.fetch = originalFetch;
  });
});

describe('computePublicKeyFp (code review round 1, Important #8 — cross-side fp pin)', () => {
  it("matches a hardcoded expected BLAKE2b-512 digest for a known input, identically to the server's independent computation", () => {
    // The exact same pinned input/output pair as
    // apps/server/src/users/users.service.spec.ts's fp-pin test — same
    // input must yield the identical digest on both sides, or a
    // legitimately-granted member's recipientKeyFp would never match
    // User.publicKeyFp server-side and every grant would silently dead-end
    // in GET /rooms/:id/keys/pending forever.
    const digest = computePublicKeyFp('e2ee-fp-pin-test-vector');
    expect(digest).toBe(
      '009be997ee9932add4e77a198900627bd485de0f425d7f0b7143122bfa05b14a702a2ae7fb9f081b19d12cf766f4bcb2897f54453c13ee2953dceed5ddaf6226'
    );
  });
});
