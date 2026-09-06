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
 *
 * `roomIsE2eeEnabled` (room.currentKeyId > 0) disambiguates a case
 * `cipher`/`pending` alone can't: cipher is null both for a plaintext room
 * AND for an E2EE room whose cipher hasn't loaded yet. It also decides how
 * to treat a message that merely LOOKS like an envelope (starts with the
 * E2E1 prefix) but fails to parse as one — a real possibility since that
 * prefix is just 4 ASCII bytes a user can type as ordinary text (code review
 * round 1, Critical #2): in a plaintext room there is no legitimate envelope
 * to fail to parse, so it renders as plain text; in an E2EE room it's
 * genuinely ambiguous (corrupted envelope vs. a typed collision) and renders
 * as the same "can't read this" state as a tampered/undecryptable envelope.
 * This function must never throw — a thrown error here previously took down
 * the entire message list (every row re-renders through this call).
 */
export function resolveMessageRenderState(
  message: MessageDto,
  cipher: DecryptCapableCipher | null,
  pending: PendingLookup,
  roomIsE2eeEnabled: boolean
): MessageRenderState {
  if (!roomIsE2eeEnabled) {
    // The room never encrypts, so even a message that happens to start with
    // "E2E1" is just user-typed text here — skip parsing it as an envelope
    // entirely rather than risk a throw over a coincidental prefix collision.
    return { type: 'plaintext', text: message.content };
  }

  let envelope: ReturnType<typeof parseEnvelope>;
  try {
    envelope = parseEnvelope(message.content);
  } catch {
    // Prefixed but malformed — either a genuinely corrupted envelope or a
    // typed "E2E1..." collision in an encrypted room. Either way, unreadable
    // rather than a crash.
    return { type: 'key-unavailable' };
  }
  if (!envelope) {
    // No prefix at all — legacy plaintext history from before this room was
    // enabled (ADR-010: enabling doesn't retroactively encrypt past history).
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
