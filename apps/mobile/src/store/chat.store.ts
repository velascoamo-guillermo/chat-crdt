import { create } from 'zustand';
import type { MessageDto } from '@chat-crdt/shared';
import type { LibsodiumContentCipher } from '../crypto/LibsodiumContentCipher';

type WsStatus = 'disconnected' | 'connecting' | 'connected';

// ADR-010: per-room E2EE runtime state, read by MessageItem to resolve each
// message's render state (decrypted / waiting-for-key / key-unavailable —
// see src/crypto/renderState.ts). The cipher instance is mutated in place
// as new grants arrive (LibsodiumContentCipher.setKey); `version` exists
// solely so replacing this wrapper object (bumpRoomCrypto) gives zustand a
// new reference to notify subscribers with, since mutating the cipher alone
// wouldn't.
export interface RoomCryptoState {
  cipher: LibsodiumContentCipher;
  /** Epochs this user has a pending (not-yet-served) grant for, in this room. */
  pendingEpochsForMe: Set<number>;
  version: number;
}

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
  roomCryptoByRoom: Record<string, RoomCryptoState | undefined>;
  setMessages: (roomId: string, messages: MessageDto[]) => void;
  setWsStatus: (roomId: string, status: WsStatus) => void;
  registerMount: (roomId: string) => void;
  clearRoom: (roomId: string) => void;
  setRoomCipher: (roomId: string, cipher: LibsodiumContentCipher) => void;
  setPendingEpochsForMe: (roomId: string, epochs: Set<number>) => void;
  bumpRoomCrypto: (roomId: string) => void;
}

export const useChatStore = create<ChatState>((set) => ({
  messagesByRoom: {},
  wsStatusByRoom: {},
  mountCounts: {},
  roomCryptoByRoom: {},
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
      const { [roomId]: _crypto, ...roomCryptoByRoom } = s.roomCryptoByRoom;
      return { messagesByRoom, wsStatusByRoom, mountCounts, roomCryptoByRoom };
    }),
  setRoomCipher: (roomId, cipher) =>
    set((s) => ({
      roomCryptoByRoom: {
        ...s.roomCryptoByRoom,
        [roomId]: { cipher, pendingEpochsForMe: s.roomCryptoByRoom[roomId]?.pendingEpochsForMe ?? new Set(), version: 0 },
      },
    })),
  setPendingEpochsForMe: (roomId, epochs) =>
    set((s) => {
      const existing = s.roomCryptoByRoom[roomId];
      if (!existing) return {};
      return {
        roomCryptoByRoom: {
          ...s.roomCryptoByRoom,
          [roomId]: { ...existing, pendingEpochsForMe: epochs, version: existing.version + 1 },
        },
      };
    }),
  bumpRoomCrypto: (roomId) =>
    set((s) => {
      const existing = s.roomCryptoByRoom[roomId];
      if (!existing) return {};
      return {
        roomCryptoByRoom: { ...s.roomCryptoByRoom, [roomId]: { ...existing, version: existing.version + 1 } },
      };
    }),
}));

const EMPTY_PENDING_EPOCHS: Set<number> = new Set();

export function useRoomCrypto(roomId: string): RoomCryptoState | undefined {
  return useChatStore((s) => s.roomCryptoByRoom[roomId]);
}

export function useRoomPendingEpochsForMe(roomId: string): Set<number> {
  return useChatStore((s) => s.roomCryptoByRoom[roomId]?.pendingEpochsForMe ?? EMPTY_PENDING_EPOCHS);
}

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
