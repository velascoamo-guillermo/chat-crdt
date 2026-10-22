import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { WsMsgType } from '@chat-crdt/shared';
import { SyncEngine } from './SyncEngine';
import { WebSocketProvider } from './WebSocketProvider';
import type { MessageDto } from '@chat-crdt/shared';

function rejectedFrame(keyId: number, ids: string[]): Uint8Array {
  const enc = encoding.createEncoder();
  encoding.writeVarUint(enc, WsMsgType.E2EE_REJECTED);
  encoding.writeVarUint(enc, keyId);
  encoding.writeVarUint(enc, ids.length);
  for (const id of ids) encoding.writeVarString(enc, id);
  return encoding.toUint8Array(enc);
}

function epochFrame(keyId: number): Uint8Array {
  const enc = encoding.createEncoder();
  encoding.writeVarUint(enc, WsMsgType.ROOM_EPOCH);
  encoding.writeVarUint(enc, keyId);
  return encoding.toUint8Array(enc);
}

function setup() {
  const engine = new SyncEngine({ roomId: 'r1', userId: 'u1', username: 'alice' });
  const sent: Uint8Array[] = [];
  const rejections: Array<{ keyId: number; retracted: MessageDto[] }> = [];
  const epochs: number[] = [];
  const provider = new WebSocketProvider(engine, {
    url: 'ws://localhost:9999',
    token: 'tok',
    _testSend: (data) => sent.push(data),
    onE2eeRejected: (r) => rejections.push(r),
    onRoomEpoch: (keyId) => epochs.push(keyId),
  });
  provider.simulateConnect();
  return { engine, provider, sent, rejections, epochs };
}

describe('WebSocketProvider T10 frames', () => {
  it('on E2EE_REJECTED, retracts the named messages and reports them', () => {
    const { engine, provider, rejections } = setup();
    const kept = engine.sendMessage('kept');
    const refused = engine.sendMessage('refused plaintext');

    provider.simulateServerMessage(rejectedFrame(2, [refused.id]));

    expect(engine.getMessages()).toEqual([kept]);
    expect(rejections).toEqual([{ keyId: 2, retracted: [refused] }]);
    provider.destroy();
    engine.destroy();
  });

  it('sends the retraction to the server', () => {
    const { engine, provider, sent } = setup();
    const refused = engine.sendMessage('refused plaintext');
    sent.length = 0;

    provider.simulateServerMessage(rejectedFrame(1, [refused.id]));

    expect(sent.length).toBeGreaterThan(0);
    for (const frame of sent) {
      expect(Buffer.from(frame).toString('utf8')).not.toContain('refused plaintext');
    }
    provider.destroy();
    engine.destroy();
  });

  it('answers the server step1 that follows a rejection with a step2 free of the retracted text', () => {
    const { engine, provider, sent } = setup();
    engine.sendMessage('queued envelope stand-in');
    const refused = engine.sendMessage('refused plaintext');
    provider.simulateServerMessage(rejectedFrame(1, [refused.id]));
    sent.length = 0;

    const step1 = encoding.createEncoder();
    encoding.writeVarUint(step1, WsMsgType.SYNC);
    encoding.writeVarUint(step1, 0); // step1
    encoding.writeVarUint8Array(step1, new Uint8Array([0])); // empty server state vector
    provider.simulateServerMessage(encoding.toUint8Array(step1));

    expect(sent).toHaveLength(1);
    const reply = decoding.createDecoder(sent[0]);
    expect(decoding.readVarUint(reply)).toBe(WsMsgType.SYNC);
    expect(decoding.readVarUint(reply)).toBe(1); // step2
    const text = Buffer.from(sent[0]).toString('utf8');
    expect(text).toContain('queued envelope stand-in');
    expect(text).not.toContain('refused plaintext');
    provider.destroy();
    engine.destroy();
  });

  it('reports a ROOM_EPOCH frame', () => {
    const { engine, provider, epochs } = setup();

    provider.simulateServerMessage(epochFrame(3));

    expect(epochs).toEqual([3]);
    provider.destroy();
    engine.destroy();
  });

  it('ignores frames after destroy', () => {
    const { engine, provider, epochs } = setup();
    provider.destroy();

    provider.simulateServerMessage(epochFrame(3));

    expect(epochs).toEqual([]);
    engine.destroy();
  });
});
