import { useEffect, useRef, useState } from 'react';
import * as SQLite from 'expo-sqlite';
import {
  SyncEngine,
  WebSocketProvider,
  SQLitePersistence,
} from '@chat-crdt/sync-engine';
import { useAuthStore } from '../store/auth.store';
import { useChatStore } from '../store/chat.store';
import { useRoomsStore } from '../store/rooms.store';
import { useE2eeCipher } from './useE2ee';
import { E2EE_PREFIX } from '../crypto/e2eeEnvelope';
import { rejectedDraftText } from '../crypto/rejectedDraft';
import { shouldAdoptLegacyDoc } from '../crypto/legacyDocPolicy';
import type { MessageDto } from '@chat-crdt/shared';

const WS_URL = process.env.EXPO_PUBLIC_WS_URL ?? 'ws://localhost:3001/sync';

// Server close code for "authenticated, but not a member of this room" (see
// apps/server/src/sync/sync.gateway.ts). Distinct from the other 4xxx codes
// (4001 bad token, 4029 rate limit) which stay mapped to the existing
// logout/backoff handling — a non-member shouldn't be logged out, just told
// they aren't in this room.
const NOT_MEMBER_CLOSE_CODE = 4003;

// T10: our own encrypted messages saved across a discard-and-resync of a
// room doc, keyed `${userId}:${roomId}`. In memory only: an app kill between
// the discard and the resync loses them (documented trade-off).
const reinsertStash = new Map<string, MessageDto[]>();

export type MembershipStatus = 'unknown' | 'ok' | 'not-a-member';

/**
 * One SyncEngine + WebSocketProvider + SQLitePersistence per mounted room
 * screen. Everything is created in the effect and torn down in its cleanup
 * so navigating away from a room (or unmounting on logout) leaves no leaked
 * socket, timer, or listener behind.
 */
export function useSync(roomId: string) {
  const token = useAuthStore(s => s.token);
  const user = useAuthStore(s => s.user);
  const logout = useAuthStore(s => s.logout);
  const setMessages = useChatStore(s => s.setMessages);
  const setWsStatus = useChatStore(s => s.setWsStatus);
  const registerMount = useChatStore(s => s.registerMount);
  const clearRoom = useChatStore(s => s.clearRoom);

  // Starts 'unknown' and only ever moves forward to 'ok' or 'not-a-member'
  // within this mount. Expo Router mounts a fresh screen instance (and thus a
  // fresh useSync call) per distinct roomId route param, so a fresh 'unknown'
  // is already correct — no need to reset it back inside the effect.
  const [membership, setMembership] = useState<MembershipStatus>('unknown');
  // T10: bumped to rebuild the engine from a freshly discarded local doc
  // after a rejection the client can't repair in place.
  const [docGeneration, setDocGeneration] = useState(0);

  const engineRef = useRef<SyncEngine | null>(null);
  const providerRef = useRef<WebSocketProvider | null>(null);

  // ADR-010: builds (and starts loading keys for) this room's ContentCipher
  // when the room is E2EE-enabled; null for 'default' or any room whose
  // currentKeyId is still 0. Resolved synchronously from useRoomsStore at
  // mount time — contentCipher is fixed at SyncEngine construction (ADR),
  // so flipping a room from disabled to enabled requires re-mounting this
  // hook (leaving/re-entering the room), not a live flag flip.
  const contentCipher = useE2eeCipher(roomId);

  // T10: authoritative E2EE-state refresh on every room entry. The cached
  // rooms list may predate an admin enabling E2EE; until this settles the
  // room reads 'unknown' (useRoomE2eeState) and the composer stays gated.
  // Its own effect so the engine rebuild below (on contentCipher) doesn't
  // refetch. WS reconnects refresh again from onStatusChange.
  useEffect(() => {
    if (!token || roomId === 'default') return;
    void useRoomsStore.getState().refreshRoom(roomId);
    // Leaving drops this entry's result, so a re-entry starts 'unknown'
    // instead of rendering one frame from the previous entry's state.
    return () => useRoomsStore.getState().stopRoomRefresh(roomId);
  }, [token, roomId]);

  useEffect(() => {
    if (!token || !user) return;

    // Registered synchronously so it's paired 1:1 with this effect's own
    // cleanup below, regardless of whether the async load()/connect chain
    // below ever settles. Safety net for double-mount navigation bugs (see
    // chat.store.ts) — clearRoom() only wipes this room's data once every
    // registered mount has torn down.
    registerMount(roomId);

    // Single shared db file across all rooms (unchanged from the single-room
    // MVP — keeps existing installs' persisted 'default' room history
    // intact across the upgrade). Row-level scoping comes from
    // SQLitePersistence's own storage key, `yjs:${engine.roomId}` — distinct
    // per room by construction, verified in
    // packages/sync-engine/src/SQLitePersistence.roomScoping.test.ts.
    const db = SQLite.openDatabaseSync('chat.db');

    const engine = new SyncEngine({
      roomId,
      userId: user.id,
      username: user.username,
      // undefined (not yet resolved, or room is E2EE-disabled) = plaintext,
      // matching SyncEngine's own "no cipher" passthrough (ADR-010).
      contentCipher: contentCipher ?? undefined,
    });
    engineRef.current = engine;

    // Use IStorage-compatible wrapper around expo-sqlite
    const storage = createExpoSQLiteStorage(db);
    // T10: local docs are per account (yjs:<userId>:<room>) — a shared key
    // let one account's unsynced plaintext be sent by the next. The old
    // shared doc is adopted only if it holds no other user's plaintext.
    const persistence = new SQLitePersistence(engine, storage, undefined, {
      scope: user.id,
      adoptLegacy: (messages) => shouldAdoptLegacyDoc(messages, user.id),
    });
    const stashKey = `${user.id}:${roomId}`;

    let provider: WebSocketProvider | null = null;
    let unsubMessages: (() => void) | null = null;
    let cancelled = false;

    persistence.load().then(() => {
      if (cancelled) return;
      // Show locally stored messages immediately
      setMessages(roomId, engine.getMessages());

      unsubMessages = engine.subscribe((msgs) => {
        setMessages(roomId, msgs);

        // Mid-session enablement detection (code review round 1, Critical
        // #1): a member already sitting in this room when an admin enables
        // E2EE has no other signal that it happened — there's no live
        // room-summary subscription, just the one-shot GET /rooms this
        // screen's rooms-list mount already did. An E2E1-prefixed message
        // arriving over sync while this device's copy of currentKeyId still
        // reads 0 is itself deterministic proof the room got enabled
        // without us knowing yet, so refetch the rooms list — that flips
        // useRoomsStore's currentKeyId, which useE2eeCipher reads reactively
        // and turns into a real cipher (tearing down and rebuilding this
        // engine with it, since contentCipher is fixed at construction).
        if (roomId === 'default') return;
        const summary = useRoomsStore.getState().rooms.find((r) => r.name === roomId);
        if (summary && summary.currentKeyId === 0 && msgs.some((m) => m.content.startsWith(E2EE_PREFIX))) {
          void useRoomsStore.getState().fetchRooms();
        }
      });

      provider = new WebSocketProvider(engine, {
        url: `${WS_URL}?room=${roomId}`,
        token,
        username: user.username,
        onStatusChange: (status) => {
          setWsStatus(roomId, status);
          // T10: the room may have been E2EE-enabled while we were
          // disconnected — re-confirm on every (re)connect.
          if (status === 'connected' && roomId !== 'default') {
            void useRoomsStore.getState().refreshRoom(roomId);
          }
        },
        // T10: the room is (or just became) E2EE — gate the composer now
        // rather than after the next refresh or the first envelope.
        onRoomEpoch: (keyId) => {
          if (roomId !== 'default') useRoomsStore.getState().noteRoomEpoch(roomId, keyId);
        },
        // T10: the server refused plaintext we sent into this E2EE room. The
        // provider already retracted those messages (so its resync goes
        // through and nothing queued alongside them is lost); gate the room
        // and hand our own text back to the composer.
        onE2eeRejected: ({ keyId, retracted }) => {
          useRoomsStore.getState().noteRoomEpoch(roomId, keyId);
          // Read the cipher now, not at provider creation: it may have
          // resolved (or gained keys) since.
          const cipher = useChatStore.getState().roomCryptoByRoom[roomId]?.cipher ?? contentCipher;
          const ours = retracted.filter((m) => m.userId === user.id);
          if (ours.length === 0) return;
          // Each refused message goes back to the composer once, even if it
          // bounces again after an engine rebuild.
          const fresh = new Set(useChatStore.getState().claimRestoredMessages(ours.map((m) => m.id)));
          if (fresh.size === 0) return;
          const text = rejectedDraftText(
            ours.filter((m) => fresh.has(m.id)),
            user.id,
            cipher ? (content, ad) => cipher.decrypt(content, ad) : null,
          );
          // Notify even when nothing can be restored (undecryptable): the
          // user still has to know it wasn't sent.
          useChatStore.getState().noteE2eeRejection(roomId, text ?? '');
        },
        // T10: the server refused something in our state we can't retract
        // (another account's leftovers, an item with no id). The provider has
        // stopped pushing state, ending the reject/resync loop. Keep our own
        // encrypted messages, drop the local doc, rebuild from the server,
        // then put back those of ours the server never got.
        onUnrecoverableE2eeRejection: ({ keyId }) => {
          useRoomsStore.getState().noteRoomEpoch(roomId, keyId);
          const ours = engine
            .getMessages()
            .filter((m) => m.userId === user.id && m.content.startsWith(E2EE_PREFIX));
          reinsertStash.set(stashKey, [...(reinsertStash.get(stashKey) ?? []), ...ours]);
          useChatStore.getState().noteE2eeRejection(roomId, '', 'resynced');
          void persistence.discard().then(() => {
            if (!cancelled) setDocGeneration((n) => n + 1);
          });
        },
        onSynced: () => {
          const stash = reinsertStash.get(stashKey);
          if (!stash) return;
          reinsertStash.delete(stashKey);
          engine.reinsertMessages(stash);
        },
        onAuthError: (code) => {
          if (code === NOT_MEMBER_CLOSE_CODE) {
            setMembership('not-a-member');
            return;
          }
          // Bad/expired token — drop it so the user re-authenticates instead
          // of looping reconnects with a dead token.
          void logout();
        },
      });
      providerRef.current = provider;
      setMembership('ok');
    });

    return () => {
      cancelled = true;
      unsubMessages?.();
      provider?.destroy();
      providerRef.current = null;
      engineRef.current = null;
      clearRoom(roomId);
      // Ordering matters and is NOT interchangeable:
      //   1. persistence.destroy() — flushes the last debounced write. Its
      //      final persist() reads engine.encodeState() synchronously
      //      before this promise's first await, so it MUST run against the
      //      still-live doc — i.e. before engine.destroy() below.
      //   2. engine.destroy() only once that flush has actually landed in
      //      storage (destroy() now resolves on the write settling, not on
      //      it merely starting — see packages/sync-engine
      //      SQLitePersistence.destroy()).
      //   3. db.closeAsync() only after both — closing the handle any
      //      earlier could race the write and silently drop up to
      //      `debounceMs` of updates on navigation/logout.
      // React doesn't await effect cleanups, hence the fire-and-forget
      // `void` — but the internal chain still runs in this exact order.
      // The db is shared across all room screens, but expo-sqlite refcounts
      // native handles per openDatabaseSync() call, so this screen's own
      // closeAsync() (called after ITS OWN flush) never affects a still-open
      // sibling room's handle.
      void persistence.destroy().then(() => {
        engine.destroy();
        return db.closeAsync();
      });
    };
    // contentCipher is intentionally a dependency: when it transitions from
    // null (not yet resolved) to a real instance, this whole effect reruns
    // — tearing down and rebuilding the engine/provider/persistence with
    // the cipher now wired in (ADR-010: contentCipher is fixed at
    // construction, so there is no "just flip a flag" path).
  }, [token, user?.id, roomId, contentCipher, docGeneration]);

  const sendMessage = (content: string) => {
    engineRef.current?.sendMessage(content);
  };

  const sendTyping = (isTyping: boolean) => {
    providerRef.current?.sendAwareness({ isTyping });
  };

  const getAwareness = () => providerRef.current?.awareness ?? null;

  return { sendMessage, sendTyping, getAwareness, membership };
}

// Thin IStorage adapter for expo-sqlite
function createExpoSQLiteStorage(db: SQLite.SQLiteDatabase) {
  const initPromise = db.execAsync(
    'CREATE TABLE IF NOT EXISTS yjs_kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)'
  );

  return {
    async getItem(key: string): Promise<string | null> {
      await initPromise;
      const row = await db.getFirstAsync<{ value: string }>(
        'SELECT value FROM yjs_kv WHERE key = ?',
        key
      );
      return row?.value ?? null;
    },
    async removeItem(key: string): Promise<void> {
      await initPromise;
      await db.runAsync('DELETE FROM yjs_kv WHERE key = ?', key);
    },
    async setItem(key: string, value: string): Promise<void> {
      await initPromise;
      await db.runAsync(
        'INSERT INTO yjs_kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
        key,
        value
      );
    },
  };
}
