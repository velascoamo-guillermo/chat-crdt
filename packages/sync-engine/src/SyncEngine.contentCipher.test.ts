import { SyncEngine } from './SyncEngine';
import { ContentCipher, MessageAad } from './ContentCipher';
import { MAX_MESSAGE_LENGTH } from '@chat-crdt/shared';

/** Fake cipher for engine-level tests — no libsodium in this package (ADR-005). */
function makeFakeCipher(): ContentCipher & { calls: { encrypt: unknown[]; decrypt: unknown[] } } {
  const calls: { encrypt: unknown[]; decrypt: unknown[] } = { encrypt: [], decrypt: [] };
  return {
    calls,
    encrypt(plaintext: string, ad: MessageAad): string {
      calls.encrypt.push({ plaintext, ad });
      return `E2E1${JSON.stringify({ v: 1, keyId: 1, nonce: 'fake-nonce', ciphertext: Buffer.from(plaintext).toString('base64'), aad: ad })}`;
    },
    decrypt(content: string, ad: MessageAad): string {
      calls.decrypt.push({ content, ad });
      const envelope = JSON.parse(content.slice(4));
      return Buffer.from(envelope.ciphertext, 'base64').toString('utf8');
    },
  };
}

describe('SyncEngine — ContentCipher (ADR-010)', () => {
  it('passes plaintext through unchanged when no cipher is configured', () => {
    const engine = new SyncEngine({ roomId: 'r1', userId: 'u1', username: 'alice' });
    const msg = engine.sendMessage('hello world');
    expect(msg.content).toBe('hello world');
    expect(msg.content.startsWith('E2E1')).toBe(false);
  });

  it('stores the E2E1-prefixed envelope returned by the injected cipher, not the plaintext', () => {
    const cipher = makeFakeCipher();
    const engine = new SyncEngine({ roomId: 'r1', userId: 'u1', username: 'alice', contentCipher: cipher });

    const msg = engine.sendMessage('secret message');

    expect(msg.content.startsWith('E2E1')).toBe(true);
    expect(msg.content).not.toContain('secret message');
    expect(engine.getMessages()[0].content).toBe(msg.content);
  });

  it('calls encrypt with the full AAD composed post-compose, pre-insert: {id, roomId, userId, username, createdAt}', () => {
    const cipher = makeFakeCipher();
    const engine = new SyncEngine({ roomId: 'room-x', userId: 'user-x', username: 'xavier', contentCipher: cipher });

    const msg = engine.sendMessage('bound message');

    expect(cipher.calls.encrypt).toHaveLength(1);
    const { plaintext, ad } = cipher.calls.encrypt[0] as { plaintext: string; ad: MessageAad };
    expect(plaintext).toBe('bound message');
    expect(ad).toEqual({
      id: msg.id,
      roomId: 'room-x',
      userId: 'user-x',
      username: 'xavier',
      createdAt: msg.createdAt,
    });
  });

  it('runs MAX_MESSAGE_LENGTH validation against plaintext, before encryption', () => {
    const cipher = makeFakeCipher();
    const engine = new SyncEngine({ roomId: 'r1', userId: 'u1', username: 'alice', contentCipher: cipher });

    expect(() => engine.sendMessage('x'.repeat(MAX_MESSAGE_LENGTH + 1))).toThrow();
    expect(cipher.calls.encrypt).toHaveLength(0);
  });

  it('send blocks (throws, no message inserted) when the cipher throws — e.g. no current-epoch key cached yet', () => {
    const throwingCipher: ContentCipher = {
      encrypt() {
        throw new Error('no current-epoch key cached');
      },
      decrypt() {
        throw new Error('unused');
      },
    };
    const engine = new SyncEngine({ roomId: 'r1', userId: 'u1', username: 'alice', contentCipher: throwingCipher });

    expect(() => engine.sendMessage('blocked')).toThrow('no current-epoch key cached');
    expect(engine.getMessages()).toHaveLength(0);
  });
});
