import type { MessageDto } from '@chat-crdt/shared';
import { parseEnvelope } from './e2eeEnvelope';

/**
 * ADR-010, "Rendering undecryptable items" — three distinct cases, rendered
 * differently so failure modes aren't confused with each other or with
 * normal messages.
 */
export type MessageRenderState =
  | { type: 'plaintext'; text: string }
  | { type: 'decrypted'; text: string }
  | { type: 'key-unavailable' }
  | { type: 'waiting-for-key' };

export interface DecryptCapableCipher {
  hasKey(keyId: number): boolean;
  decrypt(
    content: string,
    ad: { id: string; roomId: string; userId: string; username: string; createdAt: number }
  ): string;
}

export interface PendingLookup {
  /** True if a pending grant currently exists for (this room, this epoch). */
  hasPendingGrantFor(keyId: number): boolean;
}

/**
 * Read-path decision, app-side (the engine never calls ContentCipher.decrypt
 * itself — ADR-010, "The read path stays app-side"). Reconstructs `ad` from
 * fields already present on every MessageDto, in the same key order
 * LibsodiumContentCipher.encrypt used to build it.
 */
export function resolveMessageRenderState(
  message: MessageDto,
  cipher: DecryptCapableCipher | null,
  pending: PendingLookup
): MessageRenderState {
  const envelope = parseEnvelope(message.content);
  if (!envelope) {
    return { type: 'plaintext', text: message.content };
  }

  if (!cipher || !cipher.hasKey(envelope.keyId)) {
    return pending.hasPendingGrantFor(envelope.keyId)
      ? { type: 'waiting-for-key' }
      : { type: 'key-unavailable' };
  }

  const ad = {
    id: message.id,
    roomId: message.roomId,
    userId: message.userId,
    username: message.username,
    createdAt: message.createdAt,
  };
  try {
    return { type: 'decrypted', text: cipher.decrypt(message.content, ad) };
  } catch {
    // AD/key mismatch, corrupted envelope, or a tampered message (ADR-010
    // Non-Goal 3: the AEAD tag would fail here rather than silently
    // succeed) — render as unavailable rather than crashing the list.
    return { type: 'key-unavailable' };
  }
}
