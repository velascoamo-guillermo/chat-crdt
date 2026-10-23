import type { MessageDto } from '@chat-crdt/shared';
import { E2EE_PREFIX } from './e2eeEnvelope';

/**
 * T10: whether the current user may adopt the device's pre-scope local room
 * doc (`yjs:<room>`, shared by every account that ever used the device).
 * Plaintext from another user in it could be unsynced — this account would
 * push it into an E2EE room, the server would refuse it, and it isn't ours to
 * retract. Such a doc is dropped instead (the room resyncs from the server;
 * only that other account's unsynced offline messages are lost, and they
 * were never this user's to send). Encrypted messages from others are safe.
 */
export function shouldAdoptLegacyDoc(messages: readonly MessageDto[], myUserId: string): boolean {
  return messages.every((m) => m.userId === myUserId || m.content.startsWith(E2EE_PREFIX));
}
