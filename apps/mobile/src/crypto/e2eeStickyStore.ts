import type { SecureKeyValueStore } from './keyStore';

/**
 * T10: persisted per-room "this device has seen the room E2EE-enabled" flag,
 * so a stale cached summary (or a failed refresh while offline) can never
 * downgrade a room back to plaintext. Rooms only ever move 0 -> N
 * server-side, so the flag is never cleared. Not secret, but stored through
 * the same SecureKeyValueStore the room keys use to avoid a new storage dep.
 * Keys are `e2ee-ever.<room>` — SecureStore-safe since room names are
 * lowercase-alphanumeric-plus-hyphens (CreateRoomDto).
 */
export class E2eeStickyStore {
  constructor(private readonly backend: SecureKeyValueStore) {}

  async wasEverE2ee(room: string): Promise<boolean> {
    try {
      return (await this.backend.getItem(storageKey(room))) === '1';
    } catch {
      // Unreadable flag: fail closed rather than risk a plaintext send.
      return true;
    }
  }

  async markE2ee(room: string): Promise<void> {
    await this.backend.setItem(storageKey(room), '1');
  }
}

function storageKey(room: string): string {
  return `e2ee-ever.${room}`;
}
