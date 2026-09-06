/**
 * ADR-010 client-side key cache — expo-secure-store backed, injected
 * through a minimal storage interface (same pattern SyncEngine's
 * SQLitePersistence uses for IStorage) so the namespacing logic is testable
 * without expo-secure-store itself.
 */
export interface SecureKeyValueStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

export interface IdentityKeyPair {
  /** base64 X25519 public key — published server-side via PUT /users/me/public-key. */
  publicKey: string;
  /** base64 X25519 private key — device-local only, never leaves the device. */
  privateKey: string;
}

const IDENTITY_STORAGE_KEY = 'e2ee.identity';

function roomKeyStorageKey(roomId: string, keyId: number): string {
  return `e2ee.roomKey.${roomId}.${keyId}`;
}

function currentEpochStorageKey(roomId: string): string {
  return `e2ee.currentEpoch.${roomId}`;
}

/**
 * Every unwrapped (roomId, keyId) pair this device has been granted is
 * cached here — not just the current epoch, since decrypting history needs
 * the full local set (ADR-010, Key management).
 */
export class RoomKeyStore {
  constructor(private readonly backend: SecureKeyValueStore) {}

  async getIdentity(): Promise<IdentityKeyPair | null> {
    const raw = await this.backend.getItem(IDENTITY_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as IdentityKeyPair) : null;
  }

  async setIdentity(identity: IdentityKeyPair): Promise<void> {
    await this.backend.setItem(IDENTITY_STORAGE_KEY, JSON.stringify(identity));
  }

  async cacheRoomKey(roomId: string, keyId: number, keyBase64: string): Promise<void> {
    await this.backend.setItem(roomKeyStorageKey(roomId, keyId), keyBase64);
    const current = await this.getCachedCurrentEpoch(roomId);
    if (current === null || keyId > current) {
      await this.backend.setItem(currentEpochStorageKey(roomId), String(keyId));
    }
  }

  async getRoomKey(roomId: string, keyId: number): Promise<string | null> {
    return this.backend.getItem(roomKeyStorageKey(roomId, keyId));
  }

  /** Highest epoch this device has cached a key for, in this room — null if none. */
  async getCachedCurrentEpoch(roomId: string): Promise<number | null> {
    const raw = await this.backend.getItem(currentEpochStorageKey(roomId));
    return raw === null ? null : Number(raw);
  }
}
