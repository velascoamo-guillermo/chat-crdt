import * as Y from 'yjs';
import { checkEnvelopedUpdate } from './e2ee-update-gate';

// Shape of what the app sends: libsodium URLSAFE_NO_PADDING, 24-byte nonce
// (32 chars), ciphertext = plaintext + 16-byte tag.
const NONCE = 'q-9_zXk0aB2cD3eF4gH5iJ6kL7mN8oP9';
const CIPHERTEXT = 'Zm9v-YmFy_YmF6LXF1eC1xdXV4LWNvcmdl';
const ENVELOPE = `E2E1{"v":1,"keyId":1,"nonce":"${NONCE}","ciphertext":"${CIPHERTEXT}"}`;

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

const isOk = (update: Uint8Array) => checkEnvelopedUpdate(update).ok;

describe('checkEnvelopedUpdate (T10: no plaintext message inserts into an E2EE room)', () => {
  it('accepts an update that appends an E2E1-enveloped message', () => {
    const doc = new Y.Doc();
    const update = updateOf(doc, (d) => d.getArray('messages').push([msg('m1', ENVELOPE)]));
    expect(isOk(update)).toBe(true);
  });

  it('accepts the envelope the app really sends: libsodium URL-safe, unpadded base64', () => {
    // sodium.to_base64 defaults to URLSAFE_NO_PADDING ('-', '_', no '=').
    const real = ENVELOPE;
    const doc = new Y.Doc();
    const update = updateOf(doc, (d) => d.getArray('messages').push([msg('m1', real)]));
    expect(isOk(update)).toBe(true);
  });

  it('rejects an update that appends a plaintext message', () => {
    const doc = new Y.Doc();
    const update = updateOf(doc, (d) => d.getArray('messages').push([msg('m1', 'hello in the clear')]));
    expect(isOk(update)).toBe(false);
  });

  it('rejects a batch where only one of several messages is plaintext', () => {
    const doc = new Y.Doc();
    const update = updateOf(doc, (d) =>
      d.getArray('messages').push([msg('m1', ENVELOPE), msg('m2', 'leak'), msg('m3', ENVELOPE)]),
    );
    expect(isOk(update)).toBe(false);
  });

  it('rejects a plaintext message appended after existing history (parent omitted on the wire)', () => {
    const doc = new Y.Doc();
    doc.getArray('messages').push([msg('m0', ENVELOPE)]);
    const update = updateOf(doc, (d) => d.getArray('messages').push([msg('m1', 'leak')]));
    expect(isOk(update)).toBe(false);
  });

  it('rejects a full-state sync step2 that carries an offline plaintext message', () => {
    const doc = new Y.Doc();
    doc.getArray('messages').push([msg('m1', ENVELOPE), msg('m2', 'queued offline')]);
    expect(isOk(Y.encodeStateAsUpdate(doc))).toBe(false);
  });

  it('rejects message-shaped content smuggled in as a nested Y.Map', () => {
    const doc = new Y.Doc();
    const update = updateOf(doc, (d) => {
      const m = new Y.Map<string>();
      m.set('content', 'leak');
      d.getArray('messages').push([m]);
    });
    expect(isOk(update)).toBe(false);
  });

  it('rejects plain string content (not a message object)', () => {
    const doc = new Y.Doc();
    const update = updateOf(doc, (d) => d.getText('t').insert(0, 'leak'));
    expect(isOk(update)).toBe(false);
  });

  it('accepts a delete-only update', () => {
    const doc = new Y.Doc();
    doc.getArray('messages').push([msg('m1', ENVELOPE)]);
    const update = updateOf(doc, (d) => d.getArray('messages').delete(0, 1));
    expect(isOk(update)).toBe(true);
  });

  it('accepts an empty update', () => {
    expect(isOk(Y.encodeStateAsUpdate(new Y.Doc()))).toBe(true);
  });

  it('rejects a malformed update instead of throwing', () => {
    expect(isOk(new Uint8Array([0xff, 0xff, 0xff]))).toBe(false);
  });

  describe('envelope structure (not just the prefix)', () => {
    it.each([
      ['prefix only', 'E2E1'],
      ['prefix + prose', 'E2E1 anything typed by a stale client'],
      ['prefix + non-object JSON', 'E2E1"text"'],
      ['wrong version', 'E2E1{"v":2,"keyId":1,"nonce":"bg==","ciphertext":"Yw=="}'],
      ['keyId 0', 'E2E1{"v":1,"keyId":0,"nonce":"bg==","ciphertext":"Yw=="}'],
      ['fractional keyId', 'E2E1{"v":1,"keyId":1.5,"nonce":"bg==","ciphertext":"Yw=="}'],
      ['missing nonce', 'E2E1{"v":1,"keyId":1,"ciphertext":"Yw=="}'],
      ['empty ciphertext', 'E2E1{"v":1,"keyId":1,"nonce":"bg==","ciphertext":""}'],
      ['non-base64 ciphertext', `E2E1{"v":1,"keyId":1,"nonce":"${NONCE}","ciphertext":"hello world"}`],
      ['standard-alphabet base64 (the app never emits it)', `E2E1{"v":1,"keyId":1,"nonce":"${NONCE}","ciphertext":"Zm9v+YmFy/YmF6LXF1eC1xdXV4"}`],
      ['padded base64', `E2E1{"v":1,"keyId":1,"nonce":"${NONCE}","ciphertext":"Zm9vYmFyYmF6cXV4Y29yZ2U="}`],
      ['short nonce', `E2E1{"v":1,"keyId":1,"nonce":"bm9uY2U","ciphertext":"${CIPHERTEXT}"}`],
      ['readable short "ciphertext"', `E2E1{"v":1,"keyId":1,"nonce":"${NONCE}","ciphertext":"meet_at_the_bank"}`],
      ['oversized ciphertext', `E2E1{"v":1,"keyId":1,"nonce":"${NONCE}","ciphertext":"${'A'.repeat(22000)}"}`],
      ['extra envelope key', `E2E1{"v":1,"keyId":1,"nonce":"${NONCE}","ciphertext":"${CIPHERTEXT}","plain":"hi"}`],
    ])('rejects %s', (_label, content) => {
      const doc = new Y.Doc();
      const update = updateOf(doc, (d) => d.getArray('messages').push([msg('m1', content)]));
      expect(isOk(update)).toBe(false);
    });
  });

  it('rejects a message object carrying extra fields beside the envelope', () => {
    const doc = new Y.Doc();
    const update = updateOf(doc, (d) =>
      d.getArray('messages').push([{ ...msg('m1', ENVELOPE), note: 'readable side channel' }]),
    );
    expect(isOk(update)).toBe(false);
  });

  describe('rejected message ids (client recovery)', () => {
    it('names exactly the offending messages', () => {
      const doc = new Y.Doc();
      const update = updateOf(doc, (d) =>
        d.getArray('messages').push([msg('m1', ENVELOPE), msg('m2', 'leak'), msg('m3', 'leak 2')]),
      );
      expect(checkEnvelopedUpdate(update)).toEqual({ ok: false, rejectedMessageIds: ['m2', 'm3'] });
    });

    it('rejects an offending item with no usable id, naming nothing', () => {
      const doc = new Y.Doc();
      const update = updateOf(doc, (d) => d.getText('t').insert(0, 'leak'));
      expect(checkEnvelopedUpdate(update)).toEqual({ ok: false, rejectedMessageIds: [] });
    });

    it('accepts a step2 once the client deleted its rejected plaintext item (content GC-ed away)', () => {
      const doc = new Y.Doc({ gc: true });
      const messages = doc.getArray('messages');
      messages.push([msg('m1', ENVELOPE), msg('m2', 'retracted plaintext'), msg('m3', ENVELOPE)]);
      messages.delete(1, 1);

      const step2 = Y.encodeStateAsUpdate(doc);

      expect(checkEnvelopedUpdate(step2)).toEqual({ ok: true });
      expect(Buffer.from(step2).toString('utf8')).not.toContain('retracted plaintext');
    });
  });
});
