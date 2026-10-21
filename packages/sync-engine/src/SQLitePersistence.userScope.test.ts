import { SyncEngine } from './SyncEngine';
import { SQLitePersistence, MemoryStorage } from './SQLitePersistence';
import type { MessageDto } from '@chat-crdt/shared';

// T10 fix 2: the local doc was keyed yjs:<room> in a db shared by every
// account on the device, and logout cleared nothing, so account A's unsynced
// plaintext got sent by account B. Scoped keys: yjs:<userId>:<room>.
const tick = () => new Promise((r) => setTimeout(r, 10));

async function seedLegacy(storage: MemoryStorage, room: string, messages: Array<[string, string]>) {
  const engine = new SyncEngine({ roomId: room, userId: 'seed', username: 'seed' });
  for (const [userId, content] of messages) {
    engine.applyUpdate(
      (() => {
        const other = new SyncEngine({ roomId: room, userId, username: userId });
        other.sendMessage(content);
        const u = other.encodeState();
        other.destroy();
        return u;
      })(),
    );
  }
  const legacy = new SQLitePersistence(engine, storage, 0);
  await legacy.load();
  engine.sendMessage('x'); // force a write under the legacy key
  engine.retractMessages(engine.getMessages().filter((m) => m.content === 'x').map((m) => m.id));
  await tick();
  await legacy.destroy();
  engine.destroy();
}

function open(storage: MemoryStorage, userId: string, adoptLegacy?: (m: MessageDto[]) => boolean) {
  const engine = new SyncEngine({ roomId: 'room', userId, username: userId });
  const persistence = new SQLitePersistence(engine, storage, 0, { scope: userId, adoptLegacy });
  return { engine, persistence };
}

describe('SQLitePersistence — per-user scope', () => {
  it('two accounts on one device never see each other\'s local doc', async () => {
    const storage = new MemoryStorage();
    const a = open(storage, 'alice');
    await a.persistence.load();
    a.engine.sendMessage('alice offline plaintext');
    await tick();
    await a.persistence.destroy();
    a.engine.destroy();

    const b = open(storage, 'bob');
    await b.persistence.load();

    expect(b.engine.getMessages()).toEqual([]);
    expect(await storage.getItem('yjs:alice:room')).not.toBeNull();
    b.engine.destroy();
  });

  it('adopts a legacy yjs:<room> doc when the policy accepts it, then deletes the legacy key', async () => {
    const storage = new MemoryStorage();
    await seedLegacy(storage, 'room', [['alice', 'mine']]);

    const a = open(storage, 'alice', () => true);
    await a.persistence.load();

    expect(a.engine.getMessages().map((m) => m.content)).toEqual(['mine']);
    expect(await storage.getItem('yjs:room')).toBeNull();
    expect(await storage.getItem('yjs:alice:room')).not.toBeNull();
    a.engine.destroy();
  });

  it('drops a legacy doc the policy rejects (and still deletes it)', async () => {
    const storage = new MemoryStorage();
    await seedLegacy(storage, 'room', [['bob', 'bob plaintext']]);
    let seen: string[] = [];

    const a = open(storage, 'alice', (msgs) => {
      seen = msgs.map((m) => m.content);
      return false;
    });
    await a.persistence.load();

    expect(seen).toEqual(['bob plaintext']);
    expect(a.engine.getMessages()).toEqual([]);
    expect(await storage.getItem('yjs:room')).toBeNull();
    a.engine.destroy();
  });

  it('without a policy, a legacy doc is never adopted', async () => {
    const storage = new MemoryStorage();
    await seedLegacy(storage, 'room', [['alice', 'mine']]);

    const a = open(storage, 'alice');
    await a.persistence.load();

    expect(a.engine.getMessages()).toEqual([]);
    a.engine.destroy();
  });

  it('discard() deletes the stored doc and never writes it back', async () => {
    const storage = new MemoryStorage();
    const a = open(storage, 'alice');
    await a.persistence.load();
    a.engine.sendMessage('to discard');
    await tick();

    await a.persistence.discard();
    a.engine.sendMessage('after discard');
    await tick();

    expect(await storage.getItem('yjs:alice:room')).toBeNull();
    a.engine.destroy();
  });
});
