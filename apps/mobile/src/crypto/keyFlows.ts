import sodium from 'react-native-libsodium';
import { RoomKeyStore } from './keyStore';
import { computePublicKeyFp } from './publicKeyFp';
import type { LibsodiumContentCipher } from './LibsodiumContentCipher';

export interface KeyFlowsContext {
  apiBase: string;
  token: string;
}

interface ErrorBody {
  message?: string | string[];
}

async function authFetch<T>(ctx: KeyFlowsContext, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${ctx.apiBase}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ctx.token}`, ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const parsed: unknown = await res.json().catch(() => ({}));
    const body: ErrorBody = parsed && typeof parsed === 'object' ? (parsed as ErrorBody) : {};
    const message = Array.isArray(body.message) ? body.message.join(', ') : body.message;
    throw new Error(message ?? `E2EE request failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

/**
 * The user a token was issued to (its JWT `sub`), used only to pick which
 * local key namespace to read — the server still verifies the token on
 * every request, and scoping by the same id it authenticates keeps the
 * local identity in lockstep with the account the server sees.
 */
export function userIdFromToken(token: string): string {
  const payload = token.split('.')[1];
  if (!payload) throw new Error('E2EE: malformed auth token');
  const b64 = payload.replace(/-/g, '+').replace(/_/g, '/');
  const parsed: unknown = JSON.parse(atob(b64.padEnd(b64.length + ((4 - (b64.length % 4)) % 4), '=')));
  const sub = parsed && typeof parsed === 'object' ? (parsed as { sub?: unknown }).sub : undefined;
  if (typeof sub !== 'string' || sub.length === 0) throw new Error('E2EE: auth token has no subject');
  return sub;
}

/**
 * Outcome of reconciling this device's identity for the signed-in user with
 * the server's published key:
 * - `ok`: local keypair matches what's published.
 * - `published`: the server had no key; this device's (existing or fresh) one was published.
 * - `adopted-legacy`: the pre-T15 device-wide keypair matched this user's published key and now belongs to them.
 * - `republished`: no local keypair but a different one published (reinstall / new device,
 *   ADR-010 Multi-device): a fresh one replaced it, which drops this user's grants server-side.
 * - `mismatch`: a local keypair exists but the server holds a different one (replaced on another
 *   device). Neither side is touched; grants sealed to the server key won't unwrap here.
 */
export type IdentityStatus = 'ok' | 'published' | 'adopted-legacy' | 'republished' | 'mismatch';

interface PublishedKeyDto {
  publicKey: string | null;
  publicKeyFp: string | null;
}

// Callers (_layout's auth effect, every E2EE room mount) can race; two
// overlapping first-time publishes would each PUT a different keypair and
// could persist the one the server didn't keep.
const inFlight = new Map<string, Promise<IdentityStatus>>();

/**
 * Ensures the signed-in user has a published X25519 identity on this device
 * (T15: one per user, not per device). Covers users registered before
 * ADR-010 shipped (lazy publish on next login/app start, per amendment #6),
 * fresh registers, and several accounts sharing one device.
 *
 * Publish-then-persist, deliberately in that order (code review round 1,
 * Important #5): persisting a freshly generated keypair BEFORE the PUT
 * succeeded would leave a local key the server never saw, and the next call
 * would treat it as established. Persisting only after a successful PUT
 * means a failed attempt leaves no local trace, so the next call retries.
 */
export function ensureIdentityPublished(ctx: KeyFlowsContext, keyStore: RoomKeyStore): Promise<IdentityStatus> {
  const userId = userIdFromToken(ctx.token);
  const pending = inFlight.get(userId);
  if (pending) return pending;
  const run = reconcileIdentity(ctx, keyStore, userId).finally(() => inFlight.delete(userId));
  inFlight.set(userId, run);
  return run;
}

async function reconcileIdentity(ctx: KeyFlowsContext, keyStore: RoomKeyStore, userId: string): Promise<IdentityStatus> {
  const store = keyStore.forUser(userId);
  const published = await authFetch<PublishedKeyDto>(ctx, '/users/me/public-key');
  const local = await store.getIdentity();

  if (local) {
    if (published.publicKey === local.publicKey) return 'ok';
    if (published.publicKey === null) {
      await putPublicKey(ctx, local.publicKey);
      return 'published';
    }
    return 'mismatch';
  }

  // Legacy migration: the device-wide keypair goes to the account whose
  // published key matches it (and only the first such account on this
  // device — see adoptLegacyIdentity); anyone else gets a fresh one.
  if (published.publicKey !== null && (await keyStore.adoptLegacyIdentity(userId, published.publicKey))) {
    return 'adopted-legacy';
  }

  const kp = sodium.crypto_box_keypair('base64');
  await putPublicKey(ctx, kp.publicKey);
  await store.setIdentity({ publicKey: kp.publicKey, privateKey: kp.privateKey });
  return published.publicKey === null ? 'published' : 'republished';
}

async function putPublicKey(ctx: KeyFlowsContext, publicKey: string): Promise<void> {
  await authFetch(ctx, '/users/me/public-key', { method: 'PUT', body: JSON.stringify({ publicKey }) });
}

interface PendingGrantDto {
  userId: string;
  keyId: number;
  publicKey: string;
}

interface MyGrantDto {
  roomId: string;
  userId: string;
  keyId: number;
  wrappedKey: string;
  recipientKeyFp: string;
}

/**
 * First-responder pattern (ADR-010, Wrap actor): serves every pending grant
 * this device can — i.e. holds the room key for. No admin gate; any online
 * member holding the needed epoch(s) contributes, even partially.
 */
export async function servePendingGrants(
  ctx: KeyFlowsContext,
  roomId: string,
  keyStore: RoomKeyStore
): Promise<number> {
  const store = keyStore.forUser(userIdFromToken(ctx.token));
  const pending = await authFetch<PendingGrantDto[]>(ctx, `/rooms/${roomId}/keys/pending`);
  if (pending.length === 0) return 0;

  const grants: { userId: string; keyId: number; wrappedKey: string; recipientKeyFp: string }[] = [];
  for (const p of pending) {
    const keyBase64 = await store.getRoomKey(roomId, p.keyId);
    if (!keyBase64) continue; // this device doesn't hold that epoch either

    const keyBytes = sodium.from_base64(keyBase64);
    const recipientPublicKey = sodium.from_base64(p.publicKey);
    const wrappedKey = sodium.crypto_box_seal(keyBytes, recipientPublicKey, 'base64');
    // Fingerprint of the exact publicKey just used — recorded verbatim, not
    // re-derived server-side (ADR-010 narrow-race fix, Wrap actor section).
    grants.push({ userId: p.userId, keyId: p.keyId, wrappedKey, recipientKeyFp: computePublicKeyFp(p.publicKey) });
  }

  if (grants.length === 0) return 0;
  await authFetch(ctx, `/rooms/${roomId}/keys`, { method: 'POST', body: JSON.stringify({ grants }) });
  return grants.length;
}

/**
 * Fetches this user's own RoomKeyGrant rows for the room, unwraps each with
 * the local private key, and loads them into both the secure-store cache
 * and the live cipher instance so encrypt/decrypt can use them synchronously.
 */
export async function fetchAndLoadMyGrants(
  ctx: KeyFlowsContext,
  roomId: string,
  keyStore: RoomKeyStore,
  cipher: LibsodiumContentCipher
): Promise<void> {
  const store = keyStore.forUser(userIdFromToken(ctx.token));
  const identity = await store.getIdentity();
  if (!identity) return; // no identity yet — nothing to unwrap with

  const myGrants = await authFetch<MyGrantDto[]>(ctx, `/rooms/${roomId}/keys`);
  const privateKey = sodium.from_base64(identity.privateKey);
  const publicKey = sodium.from_base64(identity.publicKey);

  // T15 fix 1: unlock first, persist after. Keystore writes can take
  // seconds each under load (T16 report), and the live cipher only needs
  // the unwrapped bytes — so every key reaches setKey before any cache
  // write, and a slow or failing write can't delay or undo the unlock.
  const unwrapped: { keyId: number; keyBytes: Uint8Array }[] = [];
  for (const grant of myGrants) {
    // Per-grant isolation (code review round 1, Important #4): one bad row
    // (corrupted wrappedKey, a grant sealed to a since-rotated identity that
    // slipped past the fp check, etc.) must not throw out of the loop and
    // cost every OTHER epoch this device is otherwise perfectly able to
    // unwrap — that would turn a single-epoch problem into "this member
    // can't decrypt this room at all".
    try {
      const keyBytes = sodium.crypto_box_seal_open(sodium.from_base64(grant.wrappedKey), publicKey, privateKey);
      cipher.setKey(grant.keyId, keyBytes);
      unwrapped.push({ keyId: grant.keyId, keyBytes });
    } catch {
      // Not unwrappable with this identity (e.g. sealed to a key replaced
      // elsewhere): a key cached earlier for this epoch still works.
      const cached = await store.getRoomKey(roomId, grant.keyId).catch(() => null);
      if (cached) cipher.setKey(grant.keyId, sodium.from_base64(cached));
    }
  }

  for (const { keyId, keyBytes } of unwrapped) {
    await store.cacheRoomKey(roomId, keyId, sodium.to_base64(keyBytes)).catch(() => undefined);
  }
}

interface MemberPublicKeyDto {
  userId: string;
  publicKey: string;
}

/**
 * Recipient public keys for every current member — used to wrap a
 * brand-new epoch's key at enablement/rotation time (GET .../keys/pending
 * is empty before that epoch exists, so it can't supply this).
 */
export async function fetchRoomMembers(ctx: KeyFlowsContext, roomId: string): Promise<MemberPublicKeyDto[]> {
  return authFetch<MemberPublicKeyDto[]>(ctx, `/rooms/${roomId}/keys/members`);
}

/**
 * Enablement (0 -> 1) or rotation (ADR-010, Key-rotation trigger list):
 * mints a fresh room key, wraps it for every given member's published
 * public key, and atomically claims the epoch. Admin-gated server-side
 * (RoomKeysService.uploadGrants) — the caller is expected to already be
 * the room admin; the server is the actual enforcement point.
 */
export async function enableOrRotateRoomKey(
  ctx: KeyFlowsContext,
  roomId: string,
  expectedCurrentKeyId: number,
  members: { userId: string; publicKey: string }[],
  keyStore: RoomKeyStore,
  cipher: LibsodiumContentCipher
): Promise<{ currentKeyId: number }> {
  const store = keyStore.forUser(userIdFromToken(ctx.token));
  const newKeyId = expectedCurrentKeyId + 1;
  const roomKey = sodium.crypto_aead_xchacha20poly1305_ietf_keygen('base64');
  const roomKeyBytes = sodium.from_base64(roomKey);

  const grants = members.map((m) => {
    const recipientPublicKey = sodium.from_base64(m.publicKey);
    const wrappedKey = sodium.crypto_box_seal(roomKeyBytes, recipientPublicKey, 'base64');
    return { userId: m.userId, keyId: newKeyId, wrappedKey, recipientKeyFp: computePublicKeyFp(m.publicKey) };
  });

  const result = await authFetch<{ currentKeyId: number }>(ctx, `/rooms/${roomId}/keys`, {
    method: 'POST',
    body: JSON.stringify({ claimEpoch: { expectedCurrentKeyId }, grants }),
  });

  // Unlock before persisting (T15 fix 1): the epoch is committed server-side
  // by now, and the cache write is the slow part on Android.
  cipher.setKey(newKeyId, roomKeyBytes);
  await store.cacheRoomKey(roomId, newKeyId, roomKey);

  return result;
}
