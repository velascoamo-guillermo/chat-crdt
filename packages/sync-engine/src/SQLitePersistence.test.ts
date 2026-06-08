import { SyncEngine } from './SyncEngine';
import { SQLitePersistence, MemoryStorage } from './SQLitePersistence';

describe('SQLitePersistence', () => {
  it('load() on empty storage does not crash and leaves doc empty', async () => {
    const storage = new MemoryStorage();
    const engine = new SyncEngine({ roomId: 'r1', userId: 'u1', username: 'alice' });
    const persistence = new SQLitePersistence(engine, storage);
    await persistence.load();
    expect(engine.getMessages()).toHaveLength(0);
    expect(persistence.isLoaded()).toBe(true);
    engine.destroy();
  });

  it('persists messages and restores them in a new engine instance', async () => {
    const storage = new MemoryStorage();

    // First engine: write some messages
    const engine1 = new SyncEngine({ roomId: 'r1', userId: 'u1', username: 'alice' });
    const persistence1 = new SQLitePersistence(engine1, storage, 0);
    await persistence1.load();
    engine1.sendMessage('hello');
    engine1.sendMessage('world');

    // Wait for async persist to settle
    await new Promise(r => setTimeout(r, 10));

    engine1.destroy();

    // Second engine: should restore from storage
    const engine2 = new SyncEngine({ roomId: 'r1', userId: 'u1', username: 'alice' });
    const persistence2 = new SQLitePersistence(engine2, storage);
    await persistence2.load();

    expect(engine2.getMessages()).toHaveLength(2);
    expect(engine2.getMessages()[0].content).toBe('hello');
    expect(engine2.getMessages()[1].content).toBe('world');
    engine2.destroy();
  });

  it('updates storage when new messages arrive after load', async () => {
    const storage = new MemoryStorage();
    const engine = new SyncEngine({ roomId: 'r1', userId: 'u1', username: 'alice' });
    const persistence = new SQLitePersistence(engine, storage, 0);
    await persistence.load();

    engine.sendMessage('first');
    await new Promise(r => setTimeout(r, 10));

    // Storage should now have a non-null value
    const stored = await storage.getItem(`yjs:${engine.roomId}`);
    expect(stored).not.toBeNull();

    engine.sendMessage('second');
    await new Promise(r => setTimeout(r, 10));

    // Restore in new engine
    const engine2 = new SyncEngine({ roomId: 'r1', userId: 'u1', username: 'alice' });
    const persistence2 = new SQLitePersistence(engine2, storage);
    await persistence2.load();
    expect(engine2.getMessages()).toHaveLength(2);
    engine.destroy();
    engine2.destroy();
  });

  it('debounces writes and flushes the pending write on destroy', async () => {
    const storage = new MemoryStorage();
    const engine = new SyncEngine({ roomId: 'r1', userId: 'u1', username: 'alice' });
    const persistence = new SQLitePersistence(engine, storage, 1000);
    await persistence.load();

    engine.sendMessage('buffered');
    // Debounce window not elapsed → nothing written yet
    expect(await storage.getItem(`yjs:${engine.roomId}`)).toBeNull();

    // destroy() must flush the pending write
    persistence.destroy();
    expect(await storage.getItem(`yjs:${engine.roomId}`)).not.toBeNull();

    const engine2 = new SyncEngine({ roomId: 'r1', userId: 'u1', username: 'alice' });
    const persistence2 = new SQLitePersistence(engine2, storage);
    await persistence2.load();
    expect(engine2.getMessages()).toHaveLength(1);
    engine.destroy();
    engine2.destroy();
  });
});
