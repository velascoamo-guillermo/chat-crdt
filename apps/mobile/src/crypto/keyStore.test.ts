import { describe, it, expect, beforeEach } from 'bun:test';
import { RoomKeyStore, type SecureKeyValueStore, type UserKeyStore } from './keyStore';

function makeMemoryBackend(): SecureKeyValueStore & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    async getItem(key) {
      return map.get(key) ?? null;
    },
    async setItem(key, value) {
      map.set(key, value);
    },
    async removeItem(key) {
      map.delete(key);
    },
  };
}

describe('RoomKeyStore.forUser', () => {
  let backend: ReturnType<typeof makeMemoryBackend>;
  let store: UserKeyStore;

  beforeEach(() => {
    backend = makeMemoryBackend();
    store = new RoomKeyStore(backend).forUser('user-a');
  });

  it('returns null identity when none has been set', async () => {
    expect(await store.getIdentity()).toBeNull();
  });

  it('round-trips the identity keypair', async () => {
    await store.setIdentity({ publicKey: 'pub', privateKey: 'priv' });
    expect(await store.getIdentity()).toEqual({ publicKey: 'pub', privateKey: 'priv' });
  });

  it('caches and retrieves a room key by (roomId, keyId)', async () => {
    await store.cacheRoomKey('room-1', 1, 'key-base64-1');
    expect(await store.getRoomKey('room-1', 1)).toBe('key-base64-1');
    expect(await store.getRoomKey('room-1', 2)).toBeNull();
  });

  it('keeps per-room key caches distinct — same keyId, different room', async () => {
    await store.cacheRoomKey('room-1', 1, 'key-for-room-1');
    await store.cacheRoomKey('room-2', 1, 'key-for-room-2');
    expect(await store.getRoomKey('room-1', 1)).toBe('key-for-room-1');
    expect(await store.getRoomKey('room-2', 1)).toBe('key-for-room-2');
  });

  it('tracks the highest cached epoch as the current one, regardless of arrival order', async () => {
    await store.cacheRoomKey('room-1', 2, 'key-2');
    expect(await store.getCachedCurrentEpoch('room-1')).toBe(2);
    await store.cacheRoomKey('room-1', 1, 'key-1'); // arrives late (e.g. history backfill)
    expect(await store.getCachedCurrentEpoch('room-1')).toBe(2);
    await store.cacheRoomKey('room-1', 3, 'key-3'); // rotation
    expect(await store.getCachedCurrentEpoch('room-1')).toBe(3);
  });

  it('returns null current epoch for a room with no cached keys', async () => {
    expect(await store.getCachedCurrentEpoch('unknown-room')).toBeNull();
  });

  // Code review round 1, minor: "keyStore clear API" — recovery path for a
  // device stuck with a locally-generated-but-never-published identity.
  it('clearIdentity removes the stored identity, leaving cached room keys untouched', async () => {
    await store.setIdentity({ publicKey: 'pub', privateKey: 'priv' });
    await store.cacheRoomKey('room-1', 1, 'key-1');

    await store.clearIdentity();

    expect(await store.getIdentity()).toBeNull();
    expect(await store.getRoomKey('room-1', 1)).toBe('key-1');
  });

  // T15: one device, several accounts.
  it("never returns another user's identity", async () => {
    await store.setIdentity({ publicKey: 'pub-a', privateKey: 'priv-a' });
    const storeB = new RoomKeyStore(backend).forUser('user-b');

    expect(await storeB.getIdentity()).toBeNull();
    await storeB.setIdentity({ publicKey: 'pub-b', privateKey: 'priv-b' });
    expect(await store.getIdentity()).toEqual({ publicKey: 'pub-a', privateKey: 'priv-a' });
    expect(await storeB.getIdentity()).toEqual({ publicKey: 'pub-b', privateKey: 'priv-b' });
  });

  it("never returns another user's cached room keys or epochs", async () => {
    await store.cacheRoomKey('room-1', 1, 'key-a');
    const storeB = new RoomKeyStore(backend).forUser('user-b');

    expect(await storeB.getRoomKey('room-1', 1)).toBeNull();
    expect(await storeB.getCachedCurrentEpoch('room-1')).toBeNull();
  });

  it("clearIdentity only clears the scoped user's identity", async () => {
    await store.setIdentity({ publicKey: 'pub-a', privateKey: 'priv-a' });
    const storeB = new RoomKeyStore(backend).forUser('user-b');
    await storeB.setIdentity({ publicKey: 'pub-b', privateKey: 'priv-b' });

    await storeB.clearIdentity();

    expect(await store.getIdentity()).toEqual({ publicKey: 'pub-a', privateKey: 'priv-a' });
  });

  it('does not read the legacy unscoped identity as the user identity', async () => {
    backend.map.set('e2ee.identity', JSON.stringify({ publicKey: 'legacy-pub', privateKey: 'legacy-priv' }));
    expect(await store.getIdentity()).toBeNull();
  });

  it.each(['', 'a.b', 'a/b', 'a b'])('rejects a user id that could escape its namespace: %p', (bad) => {
    expect(() => new RoomKeyStore(backend).forUser(bad)).toThrow();
  });
});

describe('RoomKeyStore.getLegacyIdentity', () => {
  it('reads the pre-T15 device-wide identity without removing it', async () => {
    const backend = makeMemoryBackend();
    backend.map.set('e2ee.identity', JSON.stringify({ publicKey: 'legacy-pub', privateKey: 'legacy-priv' }));
    const root = new RoomKeyStore(backend);

    expect(await root.getLegacyIdentity()).toEqual({ publicKey: 'legacy-pub', privateKey: 'legacy-priv' });
    expect(backend.map.has('e2ee.identity')).toBe(true);
  });

  it('returns null when there is no legacy identity', async () => {
    expect(await new RoomKeyStore(makeMemoryBackend()).getLegacyIdentity()).toBeNull();
  });
});
