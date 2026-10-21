import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import * as syncProtocol from 'y-protocols/sync';
import { WsMsgType } from '@chat-crdt/shared';
import { SyncEngine } from './SyncEngine';
import { WebSocketProvider } from './WebSocketProvider';

// T10 fix 2: a rejection the client can't act on (it names someone else's
// message, or nothing) used to ping-pong forever: server rejects + step1,
// client answers with the same step2. The client must stop answering and
// hand the room to the app for a discard-and-resync.

function rejectedFrame(keyId: number, ids: string[]): Uint8Array {
  const enc = encoding.createEncoder();
  encoding.writeVarUint(enc, WsMsgType.E2EE_REJECTED);
  encoding.writeVarUint(enc, keyId);
  encoding.writeVarUint(enc, ids.length);
  for (const id of ids) encoding.writeVarString(enc, id);
  return encoding.toUint8Array(enc);
}

function step1Frame(serverDoc: Y.Doc): Uint8Array {
  const enc = encoding.createEncoder();
  encoding.writeVarUint(enc, WsMsgType.SYNC);
  syncProtocol.writeSyncStep1(enc, serverDoc);
  return encoding.toUint8Array(enc);
}

function isStep2OrUpdate(frame: Uint8Array): boolean {
  const d = decoding.createDecoder(frame);
  if (decoding.readVarUint(d) !== WsMsgType.SYNC) return false;
  const t = decoding.readVarUint(d);
  return t === 1 || t === 2;
}

function setup() {
  const engine = new SyncEngine({ roomId: 'r1', userId: 'me', username: 'me' });
  const sent: Uint8Array[] = [];
  const unrecoverable: number[] = [];
  const provider = new WebSocketProvider(engine, {
    url: 'ws://localhost:9999',
    token: 'tok',
    _testSend: (data) => sent.push(data),
    onUnrecoverableE2eeRejection: ({ keyId }) => unrecoverable.push(keyId),
  });
  provider.simulateConnect();
  return { engine, provider, sent, unrecoverable };
}

/** Plays the server: every step2/update the client sends that still holds
 *  `poison` is rejected with `ids` + a step1. Returns how many rounds ran. */
function playServer(
  provider: WebSocketProvider,
  sent: Uint8Array[],
  poison: string,
  ids: string[],
  maxRounds = 20,
): number {
  const serverDoc = new Y.Doc();
  let rounds = 0;
  let cursor = 0;
  while (rounds < maxRounds) {
    const fresh = sent.slice(cursor).filter(isStep2OrUpdate);
    cursor = sent.length;
    if (!fresh.some((f) => Buffer.from(f).toString('utf8').includes(poison))) break;
    rounds++;
    provider.simulateServerMessage(rejectedFrame(1, ids));
    provider.simulateServerMessage(step1Frame(serverDoc));
  }
  return rounds;
}

describe('WebSocketProvider: unrecoverable E2EE rejection', () => {
  it("ends the loop when the rejection names someone else's message", () => {
    const { engine, provider, sent, unrecoverable } = setup();
    const bob = new SyncEngine({ roomId: 'r1', userId: 'bob', username: 'bob' });
    const theirs = bob.sendMessage('bob unsynced plaintext');
    engine.applyUpdate(bob.encodeState()); // e.g. left behind by another account
    sent.length = 0;
    sent.push(...[]);
    // The client answers a first step1 with a step2 carrying bob's item.
    provider.simulateServerMessage(step1Frame(new Y.Doc()));

    const rounds = playServer(provider, sent, 'bob unsynced plaintext', [theirs.id]);

    expect(rounds).toBe(1);
    expect(unrecoverable).toEqual([1]);
    provider.destroy();
    engine.destroy();
    bob.destroy();
  });

  it('ends the loop when the rejection names nothing', () => {
    const { engine, provider, sent, unrecoverable } = setup();
    engine.doc.getText('junk').insert(0, 'not a message');
    provider.simulateServerMessage(step1Frame(new Y.Doc()));

    const rounds = playServer(provider, sent, 'not a message', []);

    expect(rounds).toBe(1);
    expect(unrecoverable).toEqual([1]);
    provider.destroy();
    engine.destroy();
  });

  it('a retractable own message is still repaired in place (no discard)', () => {
    const { engine, provider, sent, unrecoverable } = setup();
    const mine = engine.sendMessage('my plaintext');

    const rounds = playServer(provider, sent, 'my plaintext', [mine.id]);

    expect(rounds).toBe(1);
    expect(unrecoverable).toEqual([]);
    provider.destroy();
    engine.destroy();
  });

  it('a repeat rejection naming an id already retracted this session is not unrecoverable', () => {
    const { engine, provider, unrecoverable } = setup();
    const mine = engine.sendMessage('my plaintext');

    provider.simulateServerMessage(rejectedFrame(1, [mine.id]));
    provider.simulateServerMessage(rejectedFrame(1, [mine.id])); // queued copy bounced too

    expect(unrecoverable).toEqual([]);
    provider.destroy();
    engine.destroy();
  });
});

describe('WebSocketProvider: onSynced', () => {
  it('fires once, on the first step2 from the server', () => {
    const engine = new SyncEngine({ roomId: 'r1', userId: 'me', username: 'me' });
    let synced = 0;
    const provider = new WebSocketProvider(engine, {
      url: 'ws://localhost:9999',
      token: 'tok',
      _testSend: () => {},
      onSynced: () => synced++,
    });
    provider.simulateConnect();
    const server = new Y.Doc();
    const step2 = () => {
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, WsMsgType.SYNC);
      syncProtocol.writeSyncStep2(enc, server);
      return encoding.toUint8Array(enc);
    };

    provider.simulateServerMessage(step1Frame(server));
    expect(synced).toBe(0);
    provider.simulateServerMessage(step2());
    provider.simulateServerMessage(step2());

    expect(synced).toBe(1);
    provider.destroy();
    engine.destroy();
  });
});
