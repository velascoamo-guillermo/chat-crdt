import { SyncEngine } from './SyncEngine';
import { WebSocketProvider } from './WebSocketProvider';

describe('WebSocketProvider', () => {
  describe('offline queue', () => {
    it('queues updates when not connected and flushes on simulateConnect', () => {
      const engine = new SyncEngine({ roomId: 'r1', userId: 'u1', username: 'alice' });
      const sent: Uint8Array[] = [];

      const provider = new WebSocketProvider(engine, {
        url: 'ws://localhost:9999',
        token: 'tok',
        _testSend: (data) => sent.push(data),
      });

      engine.sendMessage('queued offline');
      expect(sent).toHaveLength(0); // nothing sent yet

      provider.simulateConnect();
      expect(sent.length).toBeGreaterThan(0); // flush happened
      provider.destroy();
      engine.destroy();
    });

    it('does not queue updates after destroy', () => {
      const engine = new SyncEngine({ roomId: 'r1', userId: 'u1', username: 'alice' });
      const sent: Uint8Array[] = [];

      const provider = new WebSocketProvider(engine, {
        url: 'ws://localhost:9999',
        token: 'tok',
        _testSend: (data) => sent.push(data),
      });

      provider.destroy();
      engine.sendMessage('after destroy');

      provider.simulateConnect();
      expect(sent).toHaveLength(0);
      engine.destroy();
    });
  });

  describe('status', () => {
    it('starts as disconnected in test mode', () => {
      const engine = new SyncEngine({ roomId: 'r1', userId: 'u1', username: 'alice' });
      const provider = new WebSocketProvider(engine, {
        url: 'ws://localhost:9999',
        token: 'tok',
        _testSend: () => {},
      });

      expect(provider.getStatus()).toBe('disconnected');
      provider.destroy();
      engine.destroy();
    });

    it('transitions to connected on simulateConnect', () => {
      const engine = new SyncEngine({ roomId: 'r1', userId: 'u1', username: 'alice' });
      const statuses: string[] = [];

      const provider = new WebSocketProvider(engine, {
        url: 'ws://localhost:9999',
        token: 'tok',
        _testSend: () => {},
        onStatusChange: (s) => statuses.push(s),
      });

      provider.simulateConnect();
      expect(statuses).toContain('connected');
      provider.destroy();
      engine.destroy();
    });
  });

  describe('awareness', () => {
    it('sendAwareness does not throw in test mode', () => {
      const engine = new SyncEngine({ roomId: 'r1', userId: 'u1', username: 'alice' });
      const provider = new WebSocketProvider(engine, {
        url: 'ws://localhost:9999',
        token: 'tok',
        _testSend: () => {},
      });

      expect(() => provider.sendAwareness({ isTyping: true })).not.toThrow();
      provider.destroy();
      engine.destroy();
    });
  });
});
