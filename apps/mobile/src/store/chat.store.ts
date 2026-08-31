import { create } from 'zustand';
import type { MessageDto } from '@chat-crdt/shared';

type WsStatus = 'disconnected' | 'connecting' | 'connected';

// Keyed by roomId — the app can have more than one room screen mounted at
// once (Expo Router keeps the previous stack entry mounted for back-swipe),
// so state MUST be namespaced per room. A flat single-room shape would let a
// background room's messages/status clobber the foreground room's.
//
// mountCounts is the second line of defense against double-mount bugs. The
// real dedupe is `dangerouslySingular` on the `[roomId]` screen ((chat)/
// _layout.tsx), which makes navigation reuse an already-mounted room's stack
// entry instead of pushing a duplicate. But if two screen instances for the
// same roomId are ever alive at once anyway (e.g. a future navigation change
// drops singular or reintroduces router.push), clearRoom() must not delete
// data the surviving instance still needs. registerMount/clearRoom are
// always called in matching pairs from useSync's effect mount/cleanup, so
// the count only reaches zero once every mounted instance for that room has
// torn down.
interface ChatState {
  messagesByRoom: Record<string, MessageDto[]>;
  wsStatusByRoom: Record<string, WsStatus>;
  mountCounts: Record<string, number>;
  setMessages: (roomId: string, messages: MessageDto[]) => void;
  setWsStatus: (roomId: string, status: WsStatus) => void;
  registerMount: (roomId: string) => void;
  clearRoom: (roomId: string) => void;
}

export const useChatStore = create<ChatState>((set) => ({
  messagesByRoom: {},
  wsStatusByRoom: {},
  mountCounts: {},
  setMessages: (roomId, messages) =>
    set((s) => ({ messagesByRoom: { ...s.messagesByRoom, [roomId]: messages } })),
  setWsStatus: (roomId, wsStatus) =>
    set((s) => ({ wsStatusByRoom: { ...s.wsStatusByRoom, [roomId]: wsStatus } })),
  registerMount: (roomId) =>
    set((s) => ({
      mountCounts: { ...s.mountCounts, [roomId]: (s.mountCounts[roomId] ?? 0) + 1 },
    })),
  clearRoom: (roomId) =>
    set((s) => {
      const remaining = (s.mountCounts[roomId] ?? 1) - 1;
      if (remaining > 0) {
        return { mountCounts: { ...s.mountCounts, [roomId]: remaining } };
      }
      const { [roomId]: _msgs, ...messagesByRoom } = s.messagesByRoom;
      const { [roomId]: _status, ...wsStatusByRoom } = s.wsStatusByRoom;
      const { [roomId]: _count, ...mountCounts } = s.mountCounts;
      return { messagesByRoom, wsStatusByRoom, mountCounts };
    }),
}));

// Stable reference for rooms with no messages yet. `s.messagesByRoom[roomId]
// ?? []` would allocate a NEW empty array on every single selector call —
// zustand (via useSyncExternalStore) compares snapshots by reference, so a
// fresh [] every render never equals the previous one, and React re-renders
// to get a "consistent" snapshot, which runs the selector again, which
// allocates ANOTHER new array — an infinite loop ("Maximum update depth
// exceeded"), reproducible only by actually rendering the screen (this
// shipped once already and only surfaced under the live Maestro run, not
// typecheck/lint/unit tests, which don't render anything).
const EMPTY_MESSAGES: MessageDto[] = [];

export function useRoomMessages(roomId: string): MessageDto[] {
  return useChatStore((s) => s.messagesByRoom[roomId] ?? EMPTY_MESSAGES);
}

export function useRoomWsStatus(roomId: string): WsStatus {
  return useChatStore((s) => s.wsStatusByRoom[roomId] ?? 'disconnected');
}
