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
  // T16: rooms whose flag is known to be persisted (written or read back as
  // set) this session. The flag never goes back, so re-marking them is a
  // no-op — and on Android each SecureStore write is a slow Keystore op that
  // competes with the room-key writes a live unlock waits on.
  private readonly persisted = new Set<string>();

  constructor(private readonly backend: SecureKeyValueStore) {}

  async wasEverE2ee(room: string): Promise<boolean> {
    try {
      const set = (await this.backend.getItem(storageKey(room))) === '1';
      if (set) this.persisted.add(room);
      return set;
    } catch {
      // Unreadable flag: fail closed rather than risk a plaintext send.
      return true;
    }
  }

  async markE2ee(room: string): Promise<void> {
    if (this.persisted.has(room)) return;
    await this.backend.setItem(storageKey(room), '1');
    this.persisted.add(room);
  }
}

function storageKey(room: string): string {
  return `e2ee-ever.${room}`;
}
