import * as Y from 'yjs';
import { isEnvelopedOnlyUpdate } from './e2ee-update-gate';

const ENVELOPE = 'E2E1{"v":1,"keyId":1,"nonce":"bm9uY2U=","ciphertext":"Y2lwaGVy"}';

function msg(id: string, content: string) {
  return { id, roomId: 'team-a', userId: 'u1', username: 'alice', content, createdAt: 1 };
}

/** The incremental update a client produces for one doc mutation. */
function updateOf(doc: Y.Doc, mutate: (doc: Y.Doc) => void): Uint8Array {
  let captured: Uint8Array | null = null;
  const onUpdate = (u: Uint8Array) => {
    captured = u;
  };
  doc.on('update', onUpdate);
  mutate(doc);
  doc.off('update', onUpdate);
  if (!captured) throw new Error('mutation produced no update');
  return captured;
}

describe('isEnvelopedOnlyUpdate (T10: no plaintext message inserts into an E2EE room)', () => {
  it('accepts an update that appends an E2E1-enveloped message', () => {
    const doc = new Y.Doc();
    const update = updateOf(doc, (d) => d.getArray('messages').push([msg('m1', ENVELOPE)]));
    expect(isEnvelopedOnlyUpdate(update)).toBe(true);
  });

  it('rejects an update that appends a plaintext message', () => {
    const doc = new Y.Doc();
    const update = updateOf(doc, (d) => d.getArray('messages').push([msg('m1', 'hello in the clear')]));
    expect(isEnvelopedOnlyUpdate(update)).toBe(false);
  });

  it('rejects a batch where only one of several messages is plaintext', () => {
    const doc = new Y.Doc();
    const update = updateOf(doc, (d) =>
      d.getArray('messages').push([msg('m1', ENVELOPE), msg('m2', 'leak'), msg('m3', ENVELOPE)]),
    );
    expect(isEnvelopedOnlyUpdate(update)).toBe(false);
  });

  it('rejects a plaintext message appended after existing history (parent omitted on the wire)', () => {
    const doc = new Y.Doc();
    doc.getArray('messages').push([msg('m0', ENVELOPE)]);
    const update = updateOf(doc, (d) => d.getArray('messages').push([msg('m1', 'leak')]));
    expect(isEnvelopedOnlyUpdate(update)).toBe(false);
  });

  it('rejects a full-state sync step2 that carries an offline plaintext message', () => {
    const doc = new Y.Doc();
    doc.getArray('messages').push([msg('m1', ENVELOPE), msg('m2', 'queued offline')]);
    expect(isEnvelopedOnlyUpdate(Y.encodeStateAsUpdate(doc))).toBe(false);
  });

  it('rejects message-shaped content smuggled in as a nested Y.Map', () => {
    const doc = new Y.Doc();
    const update = updateOf(doc, (d) => {
      const m = new Y.Map<string>();
      m.set('content', 'leak');
      d.getArray('messages').push([m]);
    });
    expect(isEnvelopedOnlyUpdate(update)).toBe(false);
  });

  it('rejects plain string content (not a message object)', () => {
    const doc = new Y.Doc();
    const update = updateOf(doc, (d) => d.getText('t').insert(0, 'leak'));
    expect(isEnvelopedOnlyUpdate(update)).toBe(false);
  });

  it('accepts a delete-only update', () => {
    const doc = new Y.Doc();
    doc.getArray('messages').push([msg('m1', ENVELOPE)]);
    const update = updateOf(doc, (d) => d.getArray('messages').delete(0, 1));
    expect(isEnvelopedOnlyUpdate(update)).toBe(true);
  });

  it('accepts an empty update', () => {
    expect(isEnvelopedOnlyUpdate(Y.encodeStateAsUpdate(new Y.Doc()))).toBe(true);
  });

  it('rejects a malformed update instead of throwing', () => {
    expect(isEnvelopedOnlyUpdate(new Uint8Array([0xff, 0xff, 0xff]))).toBe(false);
  });
});
