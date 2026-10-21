import * as Y from 'yjs';
import { SyncEngine } from './SyncEngine';

// T10 review I1: the server refuses a whole sync update that inserts plaintext
// into an E2EE room and names the offending message ids. The client deletes
// exactly those, so its next step2 carries them content-less and everything
// else it queued gets through.
describe('SyncEngine.retractMessages', () => {
  it('deletes exactly the named messages and returns them', () => {
    const engine = new SyncEngine({ roomId: 'r1', userId: 'u1', username: 'alice' });
    const a = engine.sendMessage('first');
    const b = engine.sendMessage('second');
    const c = engine.sendMessage('third');

    const retracted = engine.retractMessages([b.id]);

    expect(retracted).toEqual([b]);
    expect(engine.getMessages()).toEqual([a, c]);
    engine.destroy();
  });

  it("never retracts another user's message, even if the server names it", () => {
    const engine = new SyncEngine({ roomId: 'r1', userId: 'u1', username: 'alice' });
    const bob = new SyncEngine({ roomId: 'r1', userId: 'u2', username: 'bob' });
    const theirs = bob.sendMessage('bob history');
    engine.applyUpdate(bob.encodeState());
    const mine = engine.sendMessage('mine');

    const retracted = engine.retractMessages([theirs.id, mine.id]);

    expect(retracted).toEqual([mine]);
    expect(engine.getMessages()).toEqual([theirs]);
    engine.destroy();
    bob.destroy();
  });

  it('ignores ids it does not hold', () => {
    const engine = new SyncEngine({ roomId: 'r1', userId: 'u1', username: 'alice' });
    const a = engine.sendMessage('kept');

    expect(engine.retractMessages(['nope'])).toEqual([]);
    expect(engine.getMessages()).toEqual([a]);
    engine.destroy();
  });

  it('leaves no trace of the retracted content in the encoded state (what the next step2 sends)', () => {
    const engine = new SyncEngine({ roomId: 'r1', userId: 'u1', username: 'alice' });
    engine.sendMessage('kept');
    const leaked = engine.sendMessage('plaintext that must never reach the server');

    engine.retractMessages([leaked.id]);

    const state = Buffer.from(engine.encodeState()).toString('utf8');
    expect(state).not.toContain('plaintext that must never reach the server');
    expect(state).toContain('kept');
    engine.destroy();
  });

  it('propagates the retraction to a peer that already had the message', () => {
    const engine = new SyncEngine({ roomId: 'r1', userId: 'u1', username: 'alice' });
    const peer = new Y.Doc();
    engine.doc.on('update', (u: Uint8Array) => Y.applyUpdate(peer, u));
    const m = engine.sendMessage('to retract');

    engine.retractMessages([m.id]);

    expect(peer.getArray('messages').length).toBe(0);
    engine.destroy();
  });
});
