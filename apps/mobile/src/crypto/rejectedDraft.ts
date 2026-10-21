import type { MessageDto } from '@chat-crdt/shared';
import type { MessageAad } from '@chat-crdt/sync-engine';
import { E2EE_PREFIX } from './e2eeEnvelope';

export type DraftDecrypt = (content: string, ad: MessageAad) => string;

/**
 * T10: the text to put back in the composer after the server refused some
 * of our messages in an E2EE room. Only our own messages, and only what the
 * user typed: an envelope (an encrypted message the server refused anyway)
 * is decrypted with the room cipher, and dropped if that isn't possible —
 * the composer must never show the wire form. Null when nothing to restore.
 */
export function rejectedDraftText(
  retracted: readonly MessageDto[],
  myUserId: string,
  decrypt: DraftDecrypt | null,
): string | null {
  const texts: string[] = [];
  for (const m of retracted) {
    if (m.userId !== myUserId) continue;
    if (!m.content.startsWith(E2EE_PREFIX)) {
      texts.push(m.content);
      continue;
    }
    if (!decrypt) continue;
    try {
      const { id, roomId, userId, username, createdAt } = m;
      texts.push(decrypt(m.content, { id, roomId, userId, username, createdAt }));
    } catch {
      // Can't recover the plaintext: drop it rather than show ciphertext.
    }
  }
  return texts.length > 0 ? texts.join('\n') : null;
}
