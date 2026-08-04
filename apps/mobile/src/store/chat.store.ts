import { create } from 'zustand';
import type { MessageDto } from '@chat-crdt/shared';

type WsStatus = 'disconnected' | 'connecting' | 'connected';

// Keyed by roomId — the app can have more than one room screen mounted at
// once (Expo Router keeps the previous stack entry mounted for back-swipe),
// so state MUST be namespaced per room. A flat single-room shape would let a
// background room's messages/status clobber the foreground room's.
interface ChatState {
  messagesByRoom: Record<string, MessageDto[]>;
  wsStatusByRoom: Record<string, WsStatus>;
  setMessages: (roomId: string, messages: MessageDto[]) => void;
  setWsStatus: (roomId: string, status: WsStatus) => void;
  clearRoom: (roomId: string) => void;
}

export const useChatStore = create<ChatState>((set) => ({
  messagesByRoom: {},
  wsStatusByRoom: {},
  setMessages: (roomId, messages) =>
    set((s) => ({ messagesByRoom: { ...s.messagesByRoom, [roomId]: messages } })),
  setWsStatus: (roomId, wsStatus) =>
    set((s) => ({ wsStatusByRoom: { ...s.wsStatusByRoom, [roomId]: wsStatus } })),
  clearRoom: (roomId) =>
    set((s) => {
      const { [roomId]: _msgs, ...messagesByRoom } = s.messagesByRoom;
      const { [roomId]: _status, ...wsStatusByRoom } = s.wsStatusByRoom;
      return { messagesByRoom, wsStatusByRoom };
    }),
}));

export function useRoomMessages(roomId: string): MessageDto[] {
  return useChatStore((s) => s.messagesByRoom[roomId] ?? []);
}

export function useRoomWsStatus(roomId: string): WsStatus {
  return useChatStore((s) => s.wsStatusByRoom[roomId] ?? 'disconnected');
}
