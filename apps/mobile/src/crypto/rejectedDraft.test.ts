import { describe, it, expect } from 'bun:test';
import type { MessageDto } from '@chat-crdt/shared';
import { rejectedDraftText } from './rejectedDraft';

const ENVELOPE = 'E2E1{"v":1,"keyId":1,"nonce":"bm9uY2U","ciphertext":"Y2lwaGVy"}';

function msg(id: string, userId: string, content: string): MessageDto {
  return { id, roomId: 'team-a', userId, username: userId, content, createdAt: 1 };
}

// T10: when the server refuses our messages, the composer gets back what the
// user typed, never the wire form. An envelope (an encrypted message refused
// anyway) is decrypted with the room cipher; if that fails it is dropped.
describe('rejectedDraftText', () => {
  it('restores our own plaintext messages, joined by newlines', () => {
    const text = rejectedDraftText([msg('a', 'me', 'one'), msg('b', 'me', 'two')], 'me', null);
    expect(text).toBe('one\ntwo');
  });

  it("skips other users' messages", () => {
    expect(rejectedDraftText([msg('a', 'bob', 'theirs')], 'me', null)).toBeNull();
  });

  it('never restores an envelope as text: decrypts it with the cipher', () => {
    const decrypt = (content: string) => (content === ENVELOPE ? 'what I typed' : content);
    expect(rejectedDraftText([msg('a', 'me', ENVELOPE)], 'me', decrypt)).toBe('what I typed');
  });

  it('drops an envelope it cannot decrypt (no cipher, or decrypt throws)', () => {
    expect(rejectedDraftText([msg('a', 'me', ENVELOPE)], 'me', null)).toBeNull();
    const failing = () => {
      throw new Error('no key');
    };
    expect(rejectedDraftText([msg('a', 'me', ENVELOPE), msg('b', 'me', 'kept')], 'me', failing)).toBe('kept');
  });

  it('passes the message AAD fields to decrypt', () => {
    let seen: unknown = null;
    rejectedDraftText([msg('a', 'me', ENVELOPE)], 'me', (_c, ad) => {
      seen = ad;
      return 'x';
    });
    expect(seen).toEqual({ id: 'a', roomId: 'team-a', userId: 'me', username: 'me', createdAt: 1 });
  });
});
