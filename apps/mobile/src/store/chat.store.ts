import { create } from 'zustand';
import type { MessageDto } from '@chat-crdt/shared';

type WsStatus = 'disconnected' | 'connecting' | 'connected';

interface ChatState {
  messages: MessageDto[];
  wsStatus: WsStatus;
  setMessages: (messages: MessageDto[]) => void;
  setWsStatus: (status: WsStatus) => void;
}

export const useChatStore = create<ChatState>((set) => ({
  messages: [],
  wsStatus: 'disconnected',
  setMessages: (messages) => set({ messages }),
  setWsStatus: (wsStatus) => set({ wsStatus }),
}));
