import { SyncEngine } from './SyncEngine';
import { SQLitePersistence, type IStorage } from './SQLitePersistence';

/**
 * Fix for PR #25 review round 1 (Critical/Important #2): the mobile app
 * calls `await persistence.destroy()` then closes the SQLite db handle
 * right after. If destroy() resolved as soon as the write was *started*
 * (rather than once it actually *landed*), the db close could race the
 * write and silently drop up to `debounceMs` of updates on every
 * navigation/logout. This storage backend defers setItem() past several
 * microtasks (closer to how a real async SQLite write behaves) to prove
 * destroy() genuinely waits for it, not just for the write to be kicked off.
 */
class DeferredStorage implements IStorage {
  private readonly store = new Map<string, string>();
  public writeSettled = false;

  async getItem(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }

  async setItem(key: string, value: string): Promise<void> {
    // Force several real task-queue turns before the write "lands", so a
    // destroy() that only awaits a microtask (or nothing at all) would
    // resolve before this does.
    await new Promise((resolve) => setTimeout(resolve, 20));
    this.store.set(key, value);
    this.writeSettled = true;
  }
}

describe('SQLitePersistence.destroy() — awaits the flushed write', () => {
  it('does not resolve until the flushed debounced write has landed in storage', async () => {
    const storage = new DeferredStorage();
    const engine = new SyncEngine({ roomId: 'r1', userId: 'u1', username: 'alice' });
    const persistence = new SQLitePersistence(engine, storage, 1000);
    await persistence.load();

    engine.sendMessage('buffered');
    // Debounce window (1000ms) not elapsed — nothing written or even in flight yet.
    expect(storage.writeSettled).toBe(false);

    await persistence.destroy();

    // By the time destroy() resolves, the deferred write must have already
    // landed — not just been started.
    expect(storage.writeSettled).toBe(true);
    expect(await storage.getItem(`yjs:${engine.roomId}`)).not.toBeNull();

    engine.destroy();
  });

  it('awaits an already in-flight write (debounce timer fired before destroy() was called)', async () => {
    const storage = new DeferredStorage();
    const engine = new SyncEngine({ roomId: 'r2', userId: 'u1', username: 'alice' });
    const persistence = new SQLitePersistence(engine, storage, 0);
    await persistence.load();

    engine.sendMessage('immediate');
    // debounceMs=0 → the timer fires on the next tick, kicking off the
    // deferred write before we ever call destroy().
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(storage.writeSettled).toBe(false); // still in flight (20ms delay)

    await persistence.destroy();

    expect(storage.writeSettled).toBe(true);

    engine.destroy();
  });
});
