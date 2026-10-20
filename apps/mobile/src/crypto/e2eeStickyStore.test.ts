import { describe, it, expect, beforeEach } from 'bun:test';
import type { SecureKeyValueStore } from './keyStore';
import { E2eeStickyStore } from './e2eeStickyStore';

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

describe('E2eeStickyStore (T10: a room seen as E2EE can never downgrade locally)', () => {
  let backend: ReturnType<typeof makeMemoryBackend>;
  let store: E2eeStickyStore;

  beforeEach(() => {
    backend = makeMemoryBackend();
    store = new E2eeStickyStore(backend);
  });

  it('a room never marked reads false', async () => {
    expect(await store.wasEverE2ee('team-a')).toBe(false);
  });

  it('marking a room persists it across store instances', async () => {
    await store.markE2ee('team-a');
    expect(await new E2eeStickyStore(backend).wasEverE2ee('team-a')).toBe(true);
  });

  it('is scoped per room', async () => {
    await store.markE2ee('team-a');
    expect(await store.wasEverE2ee('team-b')).toBe(false);
  });

  it('uses a SecureStore-safe key (^[A-Za-z0-9._-]+$)', async () => {
    await store.markE2ee('team-a');
    for (const key of backend.map.keys()) expect(key).toMatch(/^[A-Za-z0-9._-]+$/);
  });

  it('a backend read failure fails closed (true), never silently plaintext', async () => {
    const failing = new E2eeStickyStore({
      ...backend,
      getItem: () => Promise.reject(new Error('keychain locked')),
    });
    expect(await failing.wasEverE2ee('team-a')).toBe(true);
  });
});
