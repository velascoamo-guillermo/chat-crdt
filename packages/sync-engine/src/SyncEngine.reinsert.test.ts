import { SyncEngine } from './SyncEngine';

// T10 fix 2: after discarding a room doc that can't be repaired, the user's
// own encrypted messages the server never got are re-inserted verbatim
// (same id/createdAt/content, so their AAD and ciphertext stay valid).
describe('SyncEngine.reinsertMessages', () => {
  it('appends messages whose id is not already in the doc, unchanged', () => {
    const old = new SyncEngine({ roomId: 'r1', userId: 'u1', username: 'alice' });
    const m = old.sendMessage('E2E1{"v":1}');
    old.destroy();

    const fresh = new SyncEngine({ roomId: 'r1', userId: 'u1', username: 'alice' });
    const inserted = fresh.reinsertMessages([m]);

    expect(inserted).toEqual([m]);
    expect(fresh.getMessages()).toEqual([m]);
    fresh.destroy();
  });

  it('skips ids the doc already has (the server did get them)', () => {
    const engine = new SyncEngine({ roomId: 'r1', userId: 'u1', username: 'alice' });
    const m = engine.sendMessage('E2E1{"v":1}');

    expect(engine.reinsertMessages([m])).toEqual([]);
    expect(engine.getMessages()).toHaveLength(1);
    engine.destroy();
  });
});
