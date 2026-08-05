import { useEffect, useRef, useState } from 'react';
import * as SQLite from 'expo-sqlite';
import {
  SyncEngine,
  WebSocketProvider,
  SQLitePersistence,
} from '@chat-crdt/sync-engine';
import { useAuthStore } from '../store/auth.store';
import { useChatStore } from '../store/chat.store';

const WS_URL = process.env.EXPO_PUBLIC_WS_URL ?? 'ws://localhost:3001/sync';

// Server close code for "authenticated, but not a member of this room" (see
// apps/server/src/sync/sync.gateway.ts). Distinct from the other 4xxx codes
// (4001 bad token, 4029 rate limit) which stay mapped to the existing
// logout/backoff handling — a non-member shouldn't be logged out, just told
// they aren't in this room.
const NOT_MEMBER_CLOSE_CODE = 4003;

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

  const engineRef = useRef<SyncEngine | null>(null);
  const providerRef = useRef<WebSocketProvider | null>(null);

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
    });
    engineRef.current = engine;

    // Use IStorage-compatible wrapper around expo-sqlite
    const storage = createExpoSQLiteStorage(db);
    const persistence = new SQLitePersistence(engine, storage);

    let provider: WebSocketProvider | null = null;
    let unsubMessages: (() => void) | null = null;
    let cancelled = false;

    persistence.load().then(() => {
      if (cancelled) return;
      // Show locally stored messages immediately
      setMessages(roomId, engine.getMessages());

      unsubMessages = engine.subscribe((msgs) => setMessages(roomId, msgs));

      provider = new WebSocketProvider(engine, {
        url: `${WS_URL}?room=${roomId}`,
        token,
        username: user.username,
        onStatusChange: (status) => setWsStatus(roomId, status),
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
  }, [token, user?.id, roomId]);

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
