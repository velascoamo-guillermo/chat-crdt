/**
 * ADR-010 client-side key cache — expo-secure-store backed, injected
 * through a minimal storage interface (same pattern SyncEngine's
 * SQLitePersistence uses for IStorage) so the namespacing logic is testable
 * without expo-secure-store itself.
 */
export interface SecureKeyValueStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export interface IdentityKeyPair {
  /** base64 X25519 public key — published server-side via PUT /users/me/public-key. */
  publicKey: string;
  /** base64 X25519 private key — device-local only, never leaves the device. */
  privateKey: string;
}

/** Pre-T15 device-wide identity. Read-only now: only ever adopted, never written or deleted. */
const LEGACY_IDENTITY_STORAGE_KEY = 'e2ee.identity';

/**
 * No dots: every key below starts with `e2ee.user.<userId>.`, so a dot in
 * the id could make one user's namespace a prefix-alias of another's.
 * Server ids are UUIDs (schema.prisma), well inside this set.
 */
const USER_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

/**
 * Every unwrapped (roomId, keyId) pair this device has been granted is
 * cached here — not just the current epoch, since decrypting history needs
 * the full local set (ADR-010, Key management).
 *
 * T15: ADR-010's "one X25519 keypair" is per user, so everything secret is
 * namespaced by user id. Reads go only through forUser(), which means a
 * signed-in account can't reach another account's private key or room keys
 * on a shared device.
 */
export class RoomKeyStore {
  constructor(private readonly backend: SecureKeyValueStore) {}

  forUser(userId: string): UserKeyStore {
    if (!USER_ID_PATTERN.test(userId)) throw new Error('RoomKeyStore: invalid user id');
    return new UserKeyStore(this.backend, `e2ee.user.${userId}`);
  }

  /** The unscoped keypair a pre-T15 build stored; whose it is is unknown until checked against the server. */
  async getLegacyIdentity(): Promise<IdentityKeyPair | null> {
    const raw = await this.backend.getItem(LEGACY_IDENTITY_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as IdentityKeyPair) : null;
  }
}

export class UserKeyStore {
  constructor(
    private readonly backend: SecureKeyValueStore,
    private readonly prefix: string
  ) {}

  private identityKey(): string {
    return `${this.prefix}.identity`;
  }

  private roomKeyStorageKey(roomId: string, keyId: number): string {
    return `${this.prefix}.roomKey.${roomId}.${keyId}`;
  }

  private currentEpochStorageKey(roomId: string): string {
    return `${this.prefix}.currentEpoch.${roomId}`;
  }

  async getIdentity(): Promise<IdentityKeyPair | null> {
    const raw = await this.backend.getItem(this.identityKey());
    return raw ? (JSON.parse(raw) as IdentityKeyPair) : null;
  }

  async setIdentity(identity: IdentityKeyPair): Promise<void> {
    await this.backend.setItem(this.identityKey(), JSON.stringify(identity));
  }

  /**
   * Clears this user's identity keypair (code review round 1, minor: a
   * "keyStore clear API") — manual recovery for a device stuck in a
   * locally-generated-but-never-published state, so the next
   * ensureIdentityPublished() starts clean instead of requiring a reinstall.
   * Not called on logout (T15): logging back in as the same user must keep
   * the keypair or their history stops decrypting. Does NOT touch cached
   * room keys.
   */
  async clearIdentity(): Promise<void> {
    await this.backend.removeItem(this.identityKey());
  }

  async cacheRoomKey(roomId: string, keyId: number, keyBase64: string): Promise<void> {
    await this.backend.setItem(this.roomKeyStorageKey(roomId, keyId), keyBase64);
    const current = await this.getCachedCurrentEpoch(roomId);
    if (current === null || keyId > current) {
      await this.backend.setItem(this.currentEpochStorageKey(roomId), String(keyId));
    }
  }

  async getRoomKey(roomId: string, keyId: number): Promise<string | null> {
    return this.backend.getItem(this.roomKeyStorageKey(roomId, keyId));
  }

  /** Highest epoch this user has cached a key for on this device, in this room — null if none. */
  async getCachedCurrentEpoch(roomId: string): Promise<number | null> {
    const raw = await this.backend.getItem(this.currentEpochStorageKey(roomId));
    return raw === null ? null : Number(raw);
  }
}
