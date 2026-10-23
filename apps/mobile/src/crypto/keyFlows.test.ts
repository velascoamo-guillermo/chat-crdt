import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test';
import { createHash } from 'node:crypto';
import { RoomKeyStore, type SecureKeyValueStore } from './keyStore';

// react-native-libsodium is JSI-native and unavailable under bun test (see
// e2eeEnvelope.ts's module doc comment) — mocked here with the minimal
// surface keyFlows.ts actually calls, so its OWN logic (ordering,
// per-grant error isolation) can run for real outside the RN/Hermes
// runtime. This must be registered before keyFlows.ts is first imported
// (dynamic import below), since ES module imports are cached per module URL.
let sealShouldThrowForKeyId: number | null = null;
let keypairCounter = 0;

mock.module('react-native-libsodium', () => ({
  default: {
    crypto_box_keypair: (_format: string) => {
      keypairCounter++;
      return { publicKey: `gen-pub-${keypairCounter}`, privateKey: `gen-priv-${keypairCounter}` };
    },
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

const { ensureIdentityPublished, fetchAndLoadMyGrants, servePendingGrants, userIdFromToken } = await import('./keyFlows');
const { computePublicKeyFp } = await import('./publicKeyFp');

function memoryBackend(): SecureKeyValueStore & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: async (key) => map.get(key) ?? null,
    setItem: async (key, value) => {
      map.set(key, value);
    },
    removeItem: async (key) => {
      map.delete(key);
    },
  };
}

/** Unsigned JWT-shaped token — the client only reads `sub`, the server verifies. */
function tokenFor(sub: string): string {
  const b64url = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ sub, username: sub })}.sig`;
}

function ctxFor(userId: string) {
  return { apiBase: 'http://test.local', token: tokenFor(userId) };
}

const CTX = ctxFor('u1');

/**
 * Fake /users/me/public-key: one published key per user (keyed by the
 * token's sub). `failPuts` makes the next N PUTs 500.
 */
function fakeKeyServer(published: Record<string, string | null> = {}) {
  const state = { published: { ...published }, puts: [] as { userId: string; publicKey: string }[], failPuts: 0 };
  const handler = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const auth = new Headers(init?.headers).get('Authorization') ?? '';
    const userId = userIdFromToken(auth.replace('Bearer ', ''));
    if (url.endsWith('/users/me/public-key') && (init?.method ?? 'GET') === 'GET') {
      const publicKey = state.published[userId] ?? null;
      return new Response(JSON.stringify({ publicKey, publicKeyFp: publicKey ? computePublicKeyFp(publicKey) : null }));
    }
    if (url.endsWith('/users/me/public-key') && init?.method === 'PUT') {
      if (state.failPuts > 0) {
        state.failPuts--;
        return new Response(JSON.stringify({ message: 'server down' }), { status: 500 });
      }
      const { publicKey } = JSON.parse(String(init.body)) as { publicKey: string };
      state.puts.push({ userId, publicKey });
      state.published[userId] = publicKey;
      return new Response(JSON.stringify({ publicKey, publicKeyFp: computePublicKeyFp(publicKey) }));
    }
    throw new Error(`unexpected request ${init?.method ?? 'GET'} ${url}`);
  };
  return { state, handler };
}

const originalFetch = globalThis.fetch;

function useFetch(handler: (input: string | URL | Request, init?: RequestInit) => Promise<Response>): void {
  globalThis.fetch = handler as unknown as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('userIdFromToken', () => {
  it("reads the JWT's sub", () => {
    expect(userIdFromToken(tokenFor('user-123'))).toBe('user-123');
  });

  it('throws on a token without a sub', () => {
    expect(() => userIdFromToken('not-a-jwt')).toThrow();
  });
});

describe('ensureIdentityPublished (code review round 1, Important #5)', () => {
  beforeEach(() => {
    sealShouldThrowForKeyId = null;
  });

  it('does not persist the local identity when the publish PUT fails', async () => {
    const keyStore = new RoomKeyStore(memoryBackend());
    const server = fakeKeyServer();
    server.state.failPuts = 1;
    useFetch(server.handler);

    await expect(ensureIdentityPublished(CTX, keyStore)).rejects.toThrow();
    expect(await keyStore.forUser('u1').getIdentity()).toBeNull();
  });

  it('retries with a fresh publish attempt on the next call after a failure (no stuck stored-but-unpublished state)', async () => {
    const keyStore = new RoomKeyStore(memoryBackend());
    const server = fakeKeyServer();
    server.state.failPuts = 1;
    useFetch(server.handler);

    await expect(ensureIdentityPublished(CTX, keyStore)).rejects.toThrow();
    await ensureIdentityPublished(CTX, keyStore); // succeeds this time

    expect(server.state.puts).toHaveLength(1); // the second call actually retried the PUT, not a no-op
    const stored = await keyStore.forUser('u1').getIdentity();
    expect(stored?.publicKey).toBe(server.state.puts[0]?.publicKey);
  });

  it('persists the identity only after the PUT succeeds', async () => {
    const keyStore = new RoomKeyStore(memoryBackend());
    const server = fakeKeyServer();
    useFetch(server.handler);

    await expect(ensureIdentityPublished(CTX, keyStore)).resolves.toBe('published');

    const stored = await keyStore.forUser('u1').getIdentity();
    expect(stored).not.toBeNull();
    expect(server.state.published.u1).toBe(stored!.publicKey);
  });
});

describe('ensureIdentityPublished — per-user identity (T15)', () => {
  it('keeps a matching local identity without republishing', async () => {
    const keyStore = new RoomKeyStore(memoryBackend());
    await keyStore.forUser('u1').setIdentity({ publicKey: 'pub-u1', privateKey: 'priv-u1' });
    const server = fakeKeyServer({ u1: 'pub-u1' });
    useFetch(server.handler);

    await expect(ensureIdentityPublished(CTX, keyStore)).resolves.toBe('ok');
    expect(server.state.puts).toHaveLength(0);
  });

  it('publishes an existing local identity the server has no key for', async () => {
    const keyStore = new RoomKeyStore(memoryBackend());
    await keyStore.forUser('u1').setIdentity({ publicKey: 'pub-u1', privateKey: 'priv-u1' });
    const server = fakeKeyServer();
    useFetch(server.handler);

    await expect(ensureIdentityPublished(CTX, keyStore)).resolves.toBe('published');
    expect(server.state.puts).toEqual([{ userId: 'u1', publicKey: 'pub-u1' }]);
  });

  it('reports a mismatch and overwrites neither side when the server key was replaced elsewhere', async () => {
    const keyStore = new RoomKeyStore(memoryBackend());
    await keyStore.forUser('u1').setIdentity({ publicKey: 'pub-this-device', privateKey: 'priv-this-device' });
    const server = fakeKeyServer({ u1: 'pub-other-device' });
    useFetch(server.handler);

    await expect(ensureIdentityPublished(CTX, keyStore)).resolves.toBe('mismatch');
    expect(server.state.puts).toHaveLength(0);
    expect(server.state.published.u1).toBe('pub-other-device');
    expect(await keyStore.forUser('u1').getIdentity()).toEqual({
      publicKey: 'pub-this-device',
      privateKey: 'priv-this-device',
    });
  });

  it("gives a second account on the same device its own keypair, leaving the first account's intact", async () => {
    const keyStore = new RoomKeyStore(memoryBackend());
    const server = fakeKeyServer();
    useFetch(server.handler);

    await ensureIdentityPublished(ctxFor('alice'), keyStore);
    await ensureIdentityPublished(ctxFor('bob'), keyStore);

    const alice = await keyStore.forUser('alice').getIdentity();
    const bob = await keyStore.forUser('bob').getIdentity();
    expect(alice).not.toBeNull();
    expect(bob).not.toBeNull();
    expect(bob!.privateKey).not.toBe(alice!.privateKey);
    expect(server.state.published).toEqual({ alice: alice!.publicKey, bob: bob!.publicKey });
  });

  it('keeps the same identity across logout/login of the same user', async () => {
    const keyStore = new RoomKeyStore(memoryBackend());
    const server = fakeKeyServer();
    useFetch(server.handler);

    await ensureIdentityPublished(ctxFor('alice'), keyStore);
    const first = await keyStore.forUser('alice').getIdentity();
    await ensureIdentityPublished(ctxFor('bob'), keyStore);
    await expect(ensureIdentityPublished(ctxFor('alice'), keyStore)).resolves.toBe('ok');

    expect(await keyStore.forUser('alice').getIdentity()).toEqual(first);
    expect(server.state.puts.filter((p) => p.userId === 'alice')).toHaveLength(1);
  });

  it('runs one publish per user even when called concurrently', async () => {
    const keyStore = new RoomKeyStore(memoryBackend());
    const server = fakeKeyServer();
    useFetch(server.handler);

    await Promise.all([ensureIdentityPublished(CTX, keyStore), ensureIdentityPublished(CTX, keyStore)]);

    expect(server.state.puts).toHaveLength(1);
    expect((await keyStore.forUser('u1').getIdentity())?.publicKey).toBe(server.state.puts[0]?.publicKey);
  });
});

describe('ensureIdentityPublished — legacy device-wide identity migration (T15)', () => {
  const LEGACY = { publicKey: 'legacy-pub', privateKey: 'legacy-priv' };

  function withLegacy() {
    const backend = memoryBackend();
    backend.map.set('e2ee.identity', JSON.stringify(LEGACY));
    return { backend, keyStore: new RoomKeyStore(backend) };
  }

  it('adopts the legacy identity for the user whose server key it matches, leaving the legacy entry in place', async () => {
    const { backend, keyStore } = withLegacy();
    const server = fakeKeyServer({ alice: 'legacy-pub' });
    useFetch(server.handler);

    await expect(ensureIdentityPublished(ctxFor('alice'), keyStore)).resolves.toBe('adopted-legacy');

    expect(await keyStore.forUser('alice').getIdentity()).toEqual(LEGACY);
    expect(server.state.puts).toHaveLength(0);
    expect(backend.map.get('e2ee.identity')).toBe(JSON.stringify(LEGACY));
  });

  it('never hands the legacy private key to a user with no published key', async () => {
    const { backend, keyStore } = withLegacy();
    const server = fakeKeyServer({ alice: 'legacy-pub' });
    useFetch(server.handler);

    await expect(ensureIdentityPublished(ctxFor('bob'), keyStore)).resolves.toBe('published');

    const bob = await keyStore.forUser('bob').getIdentity();
    expect(bob!.privateKey).not.toBe(LEGACY.privateKey);
    expect(server.state.published.bob).not.toBe(LEGACY.publicKey);
    expect(backend.map.get('e2ee.identity')).toBe(JSON.stringify(LEGACY));
  });

  it('never hands the legacy private key to a second user who published a copy of its public key', async () => {
    const { keyStore } = withLegacy();
    const server = fakeKeyServer({ alice: 'legacy-pub', mallory: 'legacy-pub' });
    useFetch(server.handler);

    await expect(ensureIdentityPublished(ctxFor('alice'), keyStore)).resolves.toBe('adopted-legacy');
    await expect(ensureIdentityPublished(ctxFor('mallory'), keyStore)).resolves.toBe('republished');

    expect((await keyStore.forUser('mallory').getIdentity())!.privateKey).not.toBe(LEGACY.privateKey);
  });

  it("never hands the legacy private key to a user whose server key doesn't match it", async () => {
    const { backend, keyStore } = withLegacy();
    const server = fakeKeyServer({ bob: 'bob-pub-from-other-device' });
    useFetch(server.handler);

    // No local identity for bob here: ADR-010's reinstall/new-device path.
    await expect(ensureIdentityPublished(ctxFor('bob'), keyStore)).resolves.toBe('republished');

    const bob = await keyStore.forUser('bob').getIdentity();
    expect(bob!.privateKey).not.toBe(LEGACY.privateKey);
    expect(backend.map.get('e2ee.identity')).toBe(JSON.stringify(LEGACY));
  });
});

describe('fetchAndLoadMyGrants (code review round 1, Important #4)', () => {
  beforeEach(() => {
    sealShouldThrowForKeyId = null;
  });

  it('loads every other epoch even when one grant row is corrupted (per-grant isolation)', async () => {
    const keyStore = new RoomKeyStore(memoryBackend());
    const store = keyStore.forUser('u1');
    await store.setIdentity({ publicKey: 'device-pub', privateKey: 'device-priv' });
    sealShouldThrowForKeyId = 2; // epoch 2's grant is corrupted

    useFetch(async () =>
      new Response(
        JSON.stringify([
          { roomId: 'r1', userId: 'u1', keyId: 1, wrappedKey: 'wrapped-for-epoch-1', recipientKeyFp: 'fp' },
          { roomId: 'r1', userId: 'u1', keyId: 2, wrappedKey: 'wrapped-for-epoch-2', recipientKeyFp: 'fp' },
          { roomId: 'r1', userId: 'u1', keyId: 3, wrappedKey: 'wrapped-for-epoch-3', recipientKeyFp: 'fp' },
        ]),
        { status: 200 }
      ));

    const setKeyCalls: number[] = [];
    const cipher = { setKey: (keyId: number) => setKeyCalls.push(keyId) };

    await expect(fetchAndLoadMyGrants(CTX, 'r1', keyStore, cipher as never)).resolves.toBeUndefined();

    // Epoch 2 (the corrupted one) is skipped; 1 and 3 still land.
    expect(setKeyCalls.sort()).toEqual([1, 3]);
    expect(await store.getRoomKey('r1', 1)).not.toBeNull();
    expect(await store.getRoomKey('r1', 2)).toBeNull();
    expect(await store.getRoomKey('r1', 3)).not.toBeNull();
  });

  it("never unwraps or loads with another user's identity or cached room keys (T15)", async () => {
    const keyStore = new RoomKeyStore(memoryBackend());
    await keyStore.forUser('alice').setIdentity({ publicKey: 'alice-pub', privateKey: 'alice-priv' });
    await keyStore.forUser('alice').cacheRoomKey('r1', 1, 'alice-room-key');
    let requested = false;
    useFetch(async () => {
      requested = true;
      return new Response(
        JSON.stringify([{ roomId: 'r1', userId: 'bob', keyId: 1, wrappedKey: 'w', recipientKeyFp: 'fp' }])
      );
    });
    const setKeyCalls: number[] = [];

    await fetchAndLoadMyGrants(ctxFor('bob'), 'r1', keyStore, { setKey: (k: number) => setKeyCalls.push(k) } as never);

    expect(requested).toBe(false); // bob has no identity on this device yet
    expect(setKeyCalls).toEqual([]);
  });
});

describe('servePendingGrants (T15)', () => {
  it("does not serve grants from another user's cached room keys", async () => {
    const keyStore = new RoomKeyStore(memoryBackend());
    await keyStore.forUser('alice').cacheRoomKey('r1', 1, 'alice-room-key');
    const posts: string[] = [];
    useFetch(async (input, init) => {
      if (init?.method === 'POST') posts.push(String(input));
      return new Response(JSON.stringify([{ userId: 'carol', keyId: 1, publicKey: 'carol-pub' }]));
    });

    await expect(servePendingGrants(ctxFor('bob'), 'r1', keyStore)).resolves.toBe(0);
    expect(posts).toEqual([]);
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
