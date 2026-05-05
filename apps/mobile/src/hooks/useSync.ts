import { useEffect, useRef } from 'react';
import { open } from '@op-engineering/op-sqlite';
import {
  SyncEngine,
  WebSocketProvider,
  SQLitePersistence,
} from '@chat-crdt/sync-engine';
import { useAuthStore } from '../store/auth.store';
import { useChatStore } from '../store/chat.store';

const WS_URL = process.env.EXPO_PUBLIC_WS_URL ?? 'ws://localhost:3001/sync';
const ROOM_ID = 'default';

export function useSync() {
  const token = useAuthStore(s => s.token);
  const user = useAuthStore(s => s.user);
  const setMessages = useChatStore(s => s.setMessages);
  const setWsStatus = useChatStore(s => s.setWsStatus);

  const engineRef = useRef<SyncEngine | null>(null);
  const providerRef = useRef<WebSocketProvider | null>(null);

  useEffect(() => {
    if (!token || !user) return;

    const db = open({ name: 'chat.db' });

    const engine = new SyncEngine({
      roomId: ROOM_ID,
      userId: user.id,
      username: user.username,
    });
    engineRef.current = engine;

    // Use IStorage-compatible wrapper around op-sqlite
    const storage = createOpSQLiteStorage(db);
    const persistence = new SQLitePersistence(engine, storage);

    let provider: WebSocketProvider | null = null;
    let unsubMessages: (() => void) | null = null;

    persistence.load().then(() => {
      // Show locally stored messages immediately
      setMessages(engine.getMessages());

      unsubMessages = engine.subscribe((msgs) => setMessages(msgs));

      provider = new WebSocketProvider(engine, {
        url: `${WS_URL}?room=${ROOM_ID}`,
        token,
        onStatusChange: setWsStatus,
      });
      providerRef.current = provider;
    });

    return () => {
      unsubMessages?.();
      persistence.destroy();
      provider?.destroy();
      engine.destroy();
      providerRef.current = null;
      engineRef.current = null;
    };
  }, [token, user?.id]);

  const sendMessage = (content: string) => {
    engineRef.current?.sendMessage(content);
  };

  const sendTyping = (isTyping: boolean) => {
    providerRef.current?.sendAwareness({ isTyping });
  };

  const getAwareness = () => providerRef.current?.awareness ?? null;

  return { sendMessage, sendTyping, getAwareness };
}

// Thin IStorage adapter for op-sqlite
function createOpSQLiteStorage(db: ReturnType<typeof open>) {
  const initPromise = db.execute(
    'CREATE TABLE IF NOT EXISTS yjs_kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)'
  );

  return {
    async getItem(key: string): Promise<string | null> {
      await initPromise;
      const result = await db.execute(
        'SELECT value FROM yjs_kv WHERE key = ?',
        [key]
      );
      return (result.rows?.[0]?.['value'] as string | undefined) ?? null;
    },
    async setItem(key: string, value: string): Promise<void> {
      await initPromise;
      await db.execute(
        'INSERT INTO yjs_kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
        [key, value]
      );
    },
  };
}
