import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { WsMsgType } from '@chat-crdt/shared';
import { SyncEngine } from './SyncEngine';
import { WebSocketProvider } from './WebSocketProvider';

function typeOnly(type: number): Uint8Array {
  const enc = encoding.createEncoder();
  encoding.writeVarUint(enc, type);
  return encoding.toUint8Array(enc);
}

function setup() {
  const engine = new SyncEngine({ roomId: 'r1', userId: 'u1', username: 'alice' });
  const sent: Uint8Array[] = [];
  const events: string[] = [];
  const provider = new WebSocketProvider(engine, {
    url: 'ws://localhost:9999',
    token: 'tok',
    _testSend: (data) => sent.push(data),
    onKeyRequested: () => events.push('requested'),
    onKeyGranted: () => events.push('granted'),
  });
  return { engine, provider, sent, events };
}

describe('WebSocketProvider T16 key-grant frames', () => {
  it('reports a KEY_REQUEST relay from the server', () => {
    const { engine, provider, events } = setup();
    provider.simulateConnect();

    provider.simulateServerMessage(typeOnly(WsMsgType.KEY_REQUEST));

    expect(events).toEqual(['requested']);
    provider.destroy();
    engine.destroy();
  });

  it('reports a KEY_GRANTED notice from the server', () => {
    const { engine, provider, events } = setup();
    provider.simulateConnect();

    provider.simulateServerMessage(typeOnly(WsMsgType.KEY_GRANTED));

    expect(events).toEqual(['granted']);
    provider.destroy();
    engine.destroy();
  });

  it('requestKey sends a type-only KEY_REQUEST frame while connected', () => {
    const { engine, provider, sent } = setup();
    provider.simulateConnect();
    sent.length = 0;

    expect(provider.requestKey()).toBe(true);

    expect(sent).toHaveLength(1);
    expect(sent[0].byteLength).toBe(1);
    expect(decoding.readVarUint(decoding.createDecoder(sent[0]))).toBe(WsMsgType.KEY_REQUEST);
    provider.destroy();
    engine.destroy();
  });

  it('requestKey sends nothing (and says so) while not connected or after destroy', () => {
    const { engine, provider, sent } = setup();

    expect(provider.requestKey()).toBe(false);
    provider.simulateConnect();
    provider.destroy();
    sent.length = 0;
    expect(provider.requestKey()).toBe(false);

    expect(sent).toHaveLength(0);
    engine.destroy();
  });
});
