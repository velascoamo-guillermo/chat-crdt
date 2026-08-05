import { SyncEngine } from './SyncEngine';
import { SQLitePersistence, MemoryStorage } from './SQLitePersistence';

// Multi-room support (ticket #17): the mobile app now opens one SyncEngine +
// SQLitePersistence PER ROOM, but all of them share a single underlying
// SQLite database/table (apps/mobile/src/hooks/useSync.ts opens 'chat.db'
// regardless of roomId). This test is the named acceptance criterion —
// "two rooms don't cross-contaminate persisted state" — proven against the
// same IStorage instance shared across rooms, exactly as the app shares one
// db across all its SQLitePersistence instances.
describe('SQLitePersistence — room-scoped keys (multi-room)', () => {
  it('two rooms sharing one storage backend persist independently, keyed by roomId', async () => {
    const sharedStorage = new MemoryStorage();

    const engineA = new SyncEngine({ roomId: 'room-a', userId: 'u1', username: 'alice' });
    const persistenceA = new SQLitePersistence(engineA, sharedStorage, 0);
    await persistenceA.load();
    engineA.sendMessage('hello from room a');
    await new Promise((r) => setTimeout(r, 10));

    const engineB = new SyncEngine({ roomId: 'room-b', userId: 'u1', username: 'alice' });
    const persistenceB = new SQLitePersistence(engineB, sharedStorage, 0);
    await persistenceB.load();
    engineB.sendMessage('hello from room b');
    await new Promise((r) => setTimeout(r, 10));

    // Distinct storage keys — no collision.
    expect(await sharedStorage.getItem('yjs:room-a')).not.toBeNull();
    expect(await sharedStorage.getItem('yjs:room-b')).not.toBeNull();

    engineA.destroy();
    engineB.destroy();

    // Reload each room from the shared backend and verify no cross-contamination:
    // room A must not see room B's message and vice versa.
    const reloadedA = new SyncEngine({ roomId: 'room-a', userId: 'u1', username: 'alice' });
    const reloadedPersistenceA = new SQLitePersistence(reloadedA, sharedStorage);
    await reloadedPersistenceA.load();
    expect(reloadedA.getMessages()).toHaveLength(1);
    expect(reloadedA.getMessages()[0].content).toBe('hello from room a');

    const reloadedB = new SyncEngine({ roomId: 'room-b', userId: 'u1', username: 'alice' });
    const reloadedPersistenceB = new SQLitePersistence(reloadedB, sharedStorage);
    await reloadedPersistenceB.load();
    expect(reloadedB.getMessages()).toHaveLength(1);
    expect(reloadedB.getMessages()[0].content).toBe('hello from room b');

    reloadedA.destroy();
    reloadedB.destroy();
  });

  it('the default room keeps its own independent key alongside other rooms', async () => {
    const sharedStorage = new MemoryStorage();

    const defaultEngine = new SyncEngine({ roomId: 'default', userId: 'u1', username: 'alice' });
    const defaultPersistence = new SQLitePersistence(defaultEngine, sharedStorage, 0);
    await defaultPersistence.load();
    defaultEngine.sendMessage('general chat');
    await new Promise((r) => setTimeout(r, 10));
    defaultEngine.destroy();

    const customEngine = new SyncEngine({ roomId: 'team-standup', userId: 'u1', username: 'alice' });
    const customPersistence = new SQLitePersistence(customEngine, sharedStorage, 0);
    await customPersistence.load();
    // Joining a fresh room must NOT inherit the default room's history.
    expect(customEngine.getMessages()).toHaveLength(0);
    customEngine.destroy();
  });
});
