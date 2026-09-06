import { useCallback, useEffect, useMemo } from 'react';
import { useAuthStore } from '../store/auth.store';
import { useRoomsStore } from '../store/rooms.store';
import { useChatStore } from '../store/chat.store';
import { RoomKeyStore } from '../crypto/keyStore';
import { secureStoreBackend } from '../crypto/secureStoreBackend';
import { LibsodiumContentCipher } from '../crypto/LibsodiumContentCipher';
import {
  ensureIdentityPublished,
  fetchAndLoadMyGrants,
  servePendingGrants,
  fetchRoomMembers,
  enableOrRotateRoomKey,
  type KeyFlowsContext,
} from '../crypto/keyFlows';

const API = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3001';

const keyStore = new RoomKeyStore(secureStoreBackend);

/**
 * ADR-010 wiring: builds the room's ContentCipher (only for rooms with
 * currentKeyId > 0 — the 'default' room and any freshly-created room stay
 * plaintext, matching amendment #3's scope discipline) and runs the
 * identity-publish / grant-load / first-responder-serve flows whenever a
 * room with E2EE enabled is opened.
 *
 * Returns null when the room isn't E2EE-enabled (or isn't known to
 * useRoomsStore yet — a known MVP gap: a cold deep-link straight into an
 * E2EE room, bypassing the rooms list fetch, opens in plaintext-cipher-less
 * mode this mount; reopening the room after the list has loaded works).
 */
export function useE2eeCipher(roomIdOrName: string): LibsodiumContentCipher | null {
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);
  const setRoomCipher = useChatStore((s) => s.setRoomCipher);
  const setPendingEpochsForMe = useChatStore((s) => s.setPendingEpochsForMe);
  const bumpRoomCrypto = useChatStore((s) => s.bumpRoomCrypto);

  // Derived synchronously during render, not via setState-in-effect (this
  // project's lint config rejects that pattern) — useSync's own
  // engine-construction effect depends on this value (see useSync.ts) to
  // know when to tear down and rebuild the SyncEngine with the cipher
  // (ADR-010: contentCipher is fixed at SyncEngine construction). Reads
  // useRoomsStore's snapshot synchronously; a room whose summary/currentKeyId
  // arrives AFTER this memo last ran won't retroactively produce a cipher
  // this mount (known MVP gap — see doc comment above).
  const cipher = useMemo<LibsodiumContentCipher | null>(() => {
    if (!token || !user) return null;
    if (roomIdOrName === 'default') return null; // amendment #3: default room stays E2EE-off

    const summary = useRoomsStore.getState().rooms.find((r) => r.name === roomIdOrName);
    if (!summary || summary.currentKeyId <= 0) return null;

    return new LibsodiumContentCipher();
  }, [token, user, roomIdOrName]);

  useEffect(() => {
    if (!cipher || !token || !user) return;
    const summary = useRoomsStore.getState().rooms.find((r) => r.name === roomIdOrName);
    if (!summary) return;

    setRoomCipher(roomIdOrName, cipher);

    const ctx: KeyFlowsContext = { apiBase: API, token };
    let cancelled = false;
    void (async () => {
      await ensureIdentityPublished(ctx, keyStore);
      if (cancelled) return;
      await fetchAndLoadMyGrants(ctx, summary.id, keyStore, cipher);
      if (cancelled) return;
      bumpRoomCrypto(roomIdOrName);

      // Best-effort: serve pending grants for OTHER members this device
      // holds keys for (first-responder pattern — no admin gate).
      await servePendingGrants(ctx, summary.id, keyStore).catch(() => undefined);

      // Track which epochs are pending FOR ME, for the "waiting for key"
      // vs "key unavailable" render-state distinction (ADR-010, Rendering).
      const res = await fetch(`${API}/rooms/${summary.id}/keys/pending`, {
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => null);
      if (cancelled || !res || !res.ok) return;
      const pending: { userId: string; keyId: number }[] = await res.json();
      const mine = new Set(pending.filter((p) => p.userId === user.id).map((p) => p.keyId));
      setPendingEpochsForMe(roomIdOrName, mine);
    })();

    return () => {
      cancelled = true;
    };
  }, [cipher, token, user, roomIdOrName, setRoomCipher, setPendingEpochsForMe, bumpRoomCrypto]);

  return cipher;
}

/**
 * Enablement (0 -> 1) or manual rotation, admin-only server-side. Wraps the
 * new room key for every current member's published public key and
 * atomically claims the epoch (ADR-010, Key-rotation trigger list, item 0).
 */
export function useEnableRoomE2ee() {
  const token = useAuthStore((s) => s.token);
  const fetchRooms = useRoomsStore((s) => s.fetchRooms);

  return useCallback(
    async (roomName: string) => {
      if (!token) throw new Error('Not authenticated');
      const summary = useRoomsStore.getState().rooms.find((r) => r.name === roomName);
      if (!summary) throw new Error(`Unknown room "${roomName}"`);

      const ctx: KeyFlowsContext = { apiBase: API, token };
      await ensureIdentityPublished(ctx, keyStore);
      const members = await fetchRoomMembers(ctx, summary.id);
      if (members.length === 0) {
        throw new Error('No member has published a public key yet — cannot enable encryption');
      }
      // A throwaway cipher — this call only needs the room key cached in
      // secure-store; a real cipher gets built (and this same key loaded
      // into it) the next time the room screen mounts.
      const throwawayCipher = new LibsodiumContentCipher();
      await enableOrRotateRoomKey(ctx, summary.id, summary.currentKeyId, members, keyStore, throwawayCipher);
      await fetchRooms();
    },
    [token, fetchRooms]
  );
}
