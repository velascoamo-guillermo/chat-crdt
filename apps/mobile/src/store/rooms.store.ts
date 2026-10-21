import { create } from 'zustand';
import { useAuthStore } from './auth.store';
import { useChatStore } from './chat.store';
import { E2eeStickyStore } from '../crypto/e2eeStickyStore';
import { secureStoreBackend } from '../crypto/secureStoreBackend';
import {
  resolveRoomE2eeState,
  type RoomE2eeState,
  type RoomRefreshState,
} from '../crypto/roomE2eeState';
import { createLatestWins, createRoomRefresher, type RoomsFetchResult } from '../crypto/roomRefresher';

const API = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3001';

export interface RoomSummary {
  id: string;
  name: string;
  role: string;
  /** ADR-010: 0 = E2EE not enabled for this room. Mirrors the server's RoomSummary. */
  currentKeyId: number;
}

// Nest's ValidationPipe returns `message` as either a single string or an
// array of constraint-violation strings (one per failed validator) — e.g.
// creating a reserved room name fails class-validator's @IsNotIn, which
// lands here as `message: ["name is reserved (...)"]`. Both shapes must
// surface to the user, not just the single-string case.
interface ErrorBody {
  message?: string | string[];
}

async function extractErrorMessage(res: Response, fallback: string): Promise<string> {
  const body: unknown = await res.json().catch(() => null);
  if (body && typeof body === 'object' && 'message' in body) {
    const message = (body as ErrorBody).message;
    if (typeof message === 'string') return message;
    if (Array.isArray(message) && message.every((m) => typeof m === 'string') && message.length > 0) {
      return message.join(', ');
    }
  }
  return fallback;
}

const e2eeSticky = new E2eeStickyStore(secureStoreBackend);

// Both GET /rooms callers (rooms screen, per-room refresh) go through this, so
// a response that started earlier never overwrites a newer list.
const roomsRequests = createLatestWins();

async function requestRooms(): Promise<RoomsFetchResult<RoomSummary>> {
  const token = useAuthStore.getState().token;
  if (!token) return { kind: 'http-error', status: 401 };
  const seq = roomsRequests.begin();
  let res: Response;
  try {
    res = await fetch(`${API}/rooms`, { headers: { Authorization: `Bearer ${token}` } });
  } catch {
    return { kind: 'network-error' };
  }
  if (!res.ok) return { kind: 'http-error', status: res.status };
  const rooms = (await res.json()) as RoomSummary[];
  if (roomsRequests.tryApply(seq)) {
    useRoomsStore.setState({ rooms });
    rememberE2eeRooms(rooms);
  }
  return { kind: 'ok', rooms };
}

const roomRefresher = createRoomRefresher<RoomSummary>({
  fetchRooms: requestRooms,
  isSocketConnected: (room) => useChatStore.getState().wsStatusByRoom[room] === 'connected',
  wasEverE2ee: (room) => e2eeSticky.wasEverE2ee(room),
  onEverE2ee: (room) =>
    useRoomsStore.setState((s) => ({ everE2eeByRoom: { ...s.everE2eeByRoom, [room]: true } })),
  // requestRooms already applied the list (latest-wins).
  onRooms: () => undefined,
  onRefresh: (room, state) =>
    useRoomsStore.setState((s) => {
      const { [room]: _previous, ...rest } = s.refreshByRoom;
      return { refreshByRoom: state ? { ...rest, [room]: state } : rest };
    }),
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
});

interface RoomsState {
  rooms: RoomSummary[];
  isLoading: boolean;
  error: string | null;
  /** T10: per-room authoritative summary refresh (room entry / WS reconnect). */
  refreshByRoom: Record<string, RoomRefreshState>;
  /** T10: persisted "seen E2EE-enabled on this device" flag, loaded per refresh. */
  everE2eeByRoom: Record<string, boolean>;
  fetchRooms: () => Promise<void>;
  refreshRoom: (name: string) => Promise<void>;
  /** T10: the room screen went away — stop retrying and forget its refresh state. */
  stopRoomRefresh: (name: string) => void;
  /** T10: the server says this room is E2EE at `keyId` (sync socket frame). */
  noteRoomEpoch: (name: string, keyId: number) => void;
  createRoom: (name: string) => Promise<RoomSummary>;
  joinRoom: (name: string) => Promise<RoomSummary>;
}

export const useRoomsStore = create<RoomsState>((set, get) => ({
  rooms: [],
  isLoading: false,
  error: null,
  refreshByRoom: {},
  everE2eeByRoom: {},

  fetchRooms: async () => {
    const token = useAuthStore.getState().token;
    if (!token) return;
    // Guard against overlapping fetches — e.g. the rooms screen's mount
    // effect and a pull-to-refresh firing close together would otherwise
    // both be in flight, racing to set() `rooms` with whichever resolves
    // last "winning" regardless of which one was actually most recent.
    if (get().isLoading) return;
    set({ isLoading: true, error: null });
    const result = await requestRooms();
    set(
      result.kind === 'ok'
        ? { isLoading: false }
        : {
            isLoading: false,
            error: result.kind === 'http-error' ? `Failed to load rooms (${result.status})` : 'Failed to load rooms',
          },
    );
  },

  // T10: the rooms list may have been fetched before an admin enabled E2EE,
  // so its cached currentKeyId can't decide plaintext vs E2EE on entry. This
  // re-reads it from the server (GET /rooms — there is no single-room GET,
  // and the list is small) and reports the outcome per room; until it
  // settles, useRoomE2eeState reads 'unknown' and the composer stays gated.
  // Failures other than "truly offline" stay gated and retry with backoff
  // until stopRoomRefresh (src/crypto/roomRefresher.ts). Not routed through
  // fetchRooms: its overlap guard returns early without a result.
  refreshRoom: (name: string) => roomRefresher.refresh(name),

  stopRoomRefresh: (name: string) => roomRefresher.stop(name),

  // Epochs only grow, so the frame is authoritative: bump the cached summary
  // (useE2eeCipher builds the cipher from it), settle the refresh as E2EE and
  // persist the sticky flag. The composer gates on the very next render.
  noteRoomEpoch: (name: string, keyId: number) => {
    if (keyId <= 0) return;
    set((s) => {
      const previous = s.refreshByRoom[name];
      const known = previous?.status === 'ok' ? previous.currentKeyId : 0;
      return {
        rooms: s.rooms.map((r) => (r.name === name ? { ...r, currentKeyId: Math.max(r.currentKeyId, keyId) } : r)),
        refreshByRoom: { ...s.refreshByRoom, [name]: { status: 'ok', currentKeyId: Math.max(known, keyId) } },
        everE2eeByRoom: { ...s.everE2eeByRoom, [name]: true },
      };
    });
    void e2eeSticky.markE2ee(name).catch(() => undefined);
  },

  createRoom: async (name: string) => {
    const token = useAuthStore.getState().token;
    if (!token) throw new Error('Not authenticated');
    const res = await fetch(`${API}/rooms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) throw new Error(await extractErrorMessage(res, 'Failed to create room'));
    const room = (await res.json()) as RoomSummary;
    set((s) => ({ rooms: [...s.rooms, room] }));
    return room;
  },

  joinRoom: async (name: string) => {
    const token = useAuthStore.getState().token;
    if (!token) throw new Error('Not authenticated');
    const res = await fetch(`${API}/rooms/${encodeURIComponent(name)}/join`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(await extractErrorMessage(res, 'Failed to join room'));
    const room = (await res.json()) as RoomSummary;
    set((s) => ({
      rooms: s.rooms.some((r) => r.name === room.name) ? s.rooms : [...s.rooms, room],
    }));
    return room;
  },
}));

// T10: persist the sticky flag for every room the server reports as E2EE,
// so a later stale cache or offline entry can't downgrade it to plaintext.
function rememberE2eeRooms(rooms: RoomSummary[]): void {
  const enabled = rooms.filter((r) => r.currentKeyId > 0).map((r) => r.name);
  if (enabled.length === 0) return;
  useRoomsStore.setState((s) => ({
    everE2eeByRoom: { ...s.everE2eeByRoom, ...Object.fromEntries(enabled.map((n) => [n, true])) },
  }));
  for (const name of enabled) void e2eeSticky.markE2ee(name).catch(() => undefined);
}

/**
 * T10: the room's effective E2EE state for gating sends and rendering. The
 * 'default' lobby is always plaintext (ADR-010 amendment #3). Anything else
 * reads 'unknown' until this entry's refreshRoom settles — callers must not
 * treat 'unknown' as plaintext.
 */
export function useRoomE2eeState(name: string): RoomE2eeState {
  const cachedKeyId = useRoomsStore((s) => s.rooms.find((r) => r.name === name)?.currentKeyId ?? 0);
  const refresh = useRoomsStore((s) => s.refreshByRoom[name]);
  const everE2ee = useRoomsStore((s) => s.everE2eeByRoom[name] ?? false);
  if (name === 'default') return 'plaintext';
  return resolveRoomE2eeState({ cachedKeyId, refresh, everE2ee });
}
