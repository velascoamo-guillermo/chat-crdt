import { describe, it, expect, beforeEach } from 'bun:test';
import { RoomKeyStore, type SecureKeyValueStore } from './keyStore';

function makeMemoryBackend(): SecureKeyValueStore {
  const map = new Map<string, string>();
  return {
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

describe('RoomKeyStore', () => {
  let store: RoomKeyStore;

  beforeEach(() => {
    store = new RoomKeyStore(makeMemoryBackend());
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
});
