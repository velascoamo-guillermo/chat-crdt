import { SyncEngine } from './SyncEngine';
import { MAX_MESSAGE_LENGTH } from '@chat-crdt/shared';

describe('SyncEngine', () => {
  describe('sendMessage', () => {
    it('inserts message into Yjs array', () => {
      const engine = new SyncEngine({ roomId: 'r1', userId: 'u1', username: 'alice' });
      const msg = engine.sendMessage('Hello');

      expect(msg.content).toBe('Hello');
      expect(msg.userId).toBe('u1');
      expect(msg.username).toBe('alice');
      expect(msg.roomId).toBe('r1');
      expect(typeof msg.id).toBe('string');
      expect(typeof msg.createdAt).toBe('number');

      expect(engine.getMessages()).toHaveLength(1);
      expect(engine.getMessages()[0].content).toBe('Hello');
    });

    it('appends multiple messages in order', () => {
      const engine = new SyncEngine({ roomId: 'r1', userId: 'u1', username: 'alice' });
      engine.sendMessage('first');
      engine.sendMessage('second');
      engine.sendMessage('third');

      const msgs = engine.getMessages();
      expect(msgs).toHaveLength(3);
      expect(msgs.map(m => m.content)).toEqual(['first', 'second', 'third']);
    });

    it('trims content and rejects empty/whitespace messages', () => {
      const engine = new SyncEngine({ roomId: 'r1', userId: 'u1', username: 'alice' });
      expect(engine.sendMessage('  padded  ').content).toBe('padded');
      expect(() => engine.sendMessage('   ')).toThrow();
      expect(() => engine.sendMessage('')).toThrow();
      expect(engine.getMessages()).toHaveLength(1);
    });

    it('rejects messages over MAX_MESSAGE_LENGTH', () => {
      const engine = new SyncEngine({ roomId: 'r1', userId: 'u1', username: 'alice' });
      expect(() => engine.sendMessage('x'.repeat(MAX_MESSAGE_LENGTH + 1))).toThrow();
      expect(engine.sendMessage('x'.repeat(MAX_MESSAGE_LENGTH))).toBeTruthy();
      expect(engine.getMessages()).toHaveLength(1);
    });
  });

  describe('CRDT merge', () => {
    it('two offline engines merge without duplicates', () => {
      const a = new SyncEngine({ roomId: 'room', userId: 'u1', username: 'alice' });
      const b = new SyncEngine({ roomId: 'room', userId: 'u2', username: 'bob' });

      a.sendMessage('from alice');
      b.sendMessage('from bob');

      // Exchange full state
      b.applyUpdate(a.encodeState());
      a.applyUpdate(b.encodeState());

      expect(a.getMessages()).toHaveLength(2);
      expect(b.getMessages()).toHaveLength(2);
      expect(a.getMessages().map(m => m.content).sort())
        .toEqual(b.getMessages().map(m => m.content).sort());
    });

    it('applying same update twice is idempotent', () => {
      const engine = new SyncEngine({ roomId: 'r1', userId: 'u1', username: 'alice' });
      engine.sendMessage('hello');
      const update = engine.encodeState();

      engine.applyUpdate(update);
      engine.applyUpdate(update);

      expect(engine.getMessages()).toHaveLength(1);
    });

    it('applying same remote update twice is idempotent (network retry scenario)', () => {
      const a = new SyncEngine({ roomId: 'r', userId: 'u1', username: 'alice' });
      const b = new SyncEngine({ roomId: 'r', userId: 'u2', username: 'bob' });
      a.sendMessage('hello');
      const update = a.encodeState();
      b.applyUpdate(update); // first delivery
      b.applyUpdate(update); // duplicate delivery — network retry
      expect(b.getMessages()).toHaveLength(1);
    });
  });

  describe('subscribe', () => {
    it('fires callback when message added', () => {
      const engine = new SyncEngine({ roomId: 'r1', userId: 'u1', username: 'alice' });
      const received: string[] = [];

      const unsub = engine.subscribe(msgs => {
        received.push(...msgs.map(m => m.content));
      });

      engine.sendMessage('ping');
      unsub();
      engine.sendMessage('after-unsub');

      expect(received).toContain('ping');
      expect(received).not.toContain('after-unsub');
    });
  });

  describe('encodeStateDiff', () => {
    it('returns only updates unknown to remote', () => {
      const a = new SyncEngine({ roomId: 'r', userId: 'u1', username: 'alice' });
      const b = new SyncEngine({ roomId: 'r', userId: 'u2', username: 'bob' });

      a.sendMessage('first');
      // Sync a→b
      b.applyUpdate(a.encodeState());

      // Now a sends a second message
      a.sendMessage('second');

      // b asks for only what it is missing
      const diff = a.encodeStateDiff(b.encodeStateVector());
      b.applyUpdate(diff);

      expect(b.getMessages()).toHaveLength(2);
      expect(b.getMessages()[1].content).toBe('second');
    });
  });

  it('doc has garbage collection enabled', () => {
    const engine = new SyncEngine({ roomId: 'r', userId: 'u', username: 'alice' });
    expect(engine.doc.gc).toBe(true);
    engine.destroy();
  });
});
