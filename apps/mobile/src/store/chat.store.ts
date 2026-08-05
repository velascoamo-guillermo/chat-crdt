import { create } from 'zustand';
import type { MessageDto } from '@chat-crdt/shared';

type WsStatus = 'disconnected' | 'connecting' | 'connected';

// Keyed by roomId — the app can have more than one room screen mounted at
// once (Expo Router keeps the previous stack entry mounted for back-swipe),
// so state MUST be namespaced per room. A flat single-room shape would let a
// background room's messages/status clobber the foreground room's.
//
// mountCounts is a safety net against double-mount bugs: navigation should
// dedupe (see rooms.tsx's use of router.navigate), but if two screen
// instances for the same roomId are ever alive at once (e.g. a future
// navigation change reintroduces router.push), clearRoom() must not delete
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

export function useRoomMessages(roomId: string): MessageDto[] {
  return useChatStore((s) => s.messagesByRoom[roomId] ?? []);
}

export function useRoomWsStatus(roomId: string): WsStatus {
  return useChatStore((s) => s.wsStatusByRoom[roomId] ?? 'disconnected');
}
