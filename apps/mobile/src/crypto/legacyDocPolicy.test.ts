import { describe, it, expect } from 'bun:test';
import type { MessageDto } from '@chat-crdt/shared';
import { shouldAdoptLegacyDoc } from './legacyDocPolicy';

const ENVELOPE = 'E2E1{"v":1,"keyId":1,"nonce":"n","ciphertext":"c"}';
const msg = (userId: string, content: string): MessageDto => ({
  id: `${userId}-${content}`,
  roomId: 'r',
  userId,
  username: userId,
  content,
  createdAt: 1,
});

// T10 fix 2: the pre-scope yjs:<room> doc was shared by every account on the
// device. Adopt it for the current user only if it holds no plaintext from
// anyone else (which this account could otherwise push to the server and
// never be able to retract); otherwise drop it and resync from the server.
describe('shouldAdoptLegacyDoc', () => {
  it('adopts a doc with only my messages', () => {
    expect(shouldAdoptLegacyDoc([msg('me', 'hi'), msg('me', ENVELOPE)], 'me')).toBe(true);
  });

  it("adopts a doc whose other users' messages are all encrypted", () => {
    expect(shouldAdoptLegacyDoc([msg('me', 'hi'), msg('bob', ENVELOPE)], 'me')).toBe(true);
  });

  it('drops a doc holding plaintext from another user', () => {
    expect(shouldAdoptLegacyDoc([msg('me', 'hi'), msg('bob', 'bob plaintext')], 'me')).toBe(false);
  });

  it('adopts an empty doc', () => {
    expect(shouldAdoptLegacyDoc([], 'me')).toBe(true);
  });
});
