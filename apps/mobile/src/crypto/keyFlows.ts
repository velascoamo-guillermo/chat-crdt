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
 * Ensures this device has a published X25519 identity — generating one if
 * missing. Covers both users registered before ADR-010 shipped (lazy
 * publish on next login/app start, per amendment #6) and the initial
 * publish for anyone new; republish-on-reinstall reuses the same call once
 * the local keypair is known to be gone (see PUT /users/me/public-key
 * deleting stale grants server-side).
 *
 * Publish-then-persist, deliberately in that order (code review round 1,
 * Important #5): persisting the keypair locally BEFORE the PUT succeeded
 * would make this function's own early-return (`if (existing) return`)
 * permanently skip retrying — a keypair that exists locally but was never
 * actually published (e.g. the PUT failed the very first time this ran) is
 * a stuck state with no recovery path, since nothing else ever calls this
 * again with a fresh keypair once `existing` is non-null. Persisting only
 * after a successful PUT means a failed attempt leaves no local trace, so
 * the next call starts clean and actually retries.
 */
export async function ensureIdentityPublished(ctx: KeyFlowsContext, keyStore: RoomKeyStore): Promise<void> {
  const existing = await keyStore.getIdentity();
  if (existing) return;

  const kp = sodium.crypto_box_keypair('base64');
  await authFetch(ctx, '/users/me/public-key', {
    method: 'PUT',
    body: JSON.stringify({ publicKey: kp.publicKey }),
  });
  await keyStore.setIdentity({ publicKey: kp.publicKey, privateKey: kp.privateKey });
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
  const pending = await authFetch<PendingGrantDto[]>(ctx, `/rooms/${roomId}/keys/pending`);
  if (pending.length === 0) return 0;

  const grants: { userId: string; keyId: number; wrappedKey: string; recipientKeyFp: string }[] = [];
  for (const p of pending) {
    const keyBase64 = await keyStore.getRoomKey(roomId, p.keyId);
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
  const identity = await keyStore.getIdentity();
  if (!identity) return; // no identity yet — nothing to unwrap with

  const myGrants = await authFetch<MyGrantDto[]>(ctx, `/rooms/${roomId}/keys`);
  const privateKey = sodium.from_base64(identity.privateKey);
  const publicKey = sodium.from_base64(identity.publicKey);

  for (const grant of myGrants) {
    // Per-grant isolation (code review round 1, Important #4): one bad row
    // (corrupted wrappedKey, a grant sealed to a since-rotated identity that
    // slipped past the fp check, etc.) must not throw out of the loop and
    // cost every OTHER epoch this device is otherwise perfectly able to
    // unwrap — that would turn a single-epoch problem into "this member
    // can't decrypt this room at all".
    try {
      const cached = await keyStore.getRoomKey(roomId, grant.keyId);
      if (cached) {
        cipher.setKey(grant.keyId, sodium.from_base64(cached));
        continue;
      }
      const wrapped = sodium.from_base64(grant.wrappedKey);
      const keyBytes = sodium.crypto_box_seal_open(wrapped, publicKey, privateKey);
      await keyStore.cacheRoomKey(roomId, grant.keyId, sodium.to_base64(keyBytes));
      cipher.setKey(grant.keyId, keyBytes);
    } catch {
      continue;
    }
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

  await keyStore.cacheRoomKey(roomId, newKeyId, roomKey);
  cipher.setKey(newKeyId, roomKeyBytes);

  return result;
}
