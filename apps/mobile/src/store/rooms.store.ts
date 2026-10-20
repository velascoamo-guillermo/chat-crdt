import { create } from 'zustand';
import { useAuthStore } from './auth.store';
import { E2eeStickyStore } from '../crypto/e2eeStickyStore';
import { secureStoreBackend } from '../crypto/secureStoreBackend';
import {
  resolveRoomE2eeState,
  type RoomE2eeState,
  type RoomRefreshState,
} from '../crypto/roomE2eeState';

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

// One in-flight authoritative refresh per room: room entry and the first WS
// 'connected' fire close together and should share a single GET.
const refreshesInFlight = new Map<string, Promise<void>>();

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
    try {
      const res = await fetch(`${API}/rooms`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(await extractErrorMessage(res, 'Failed to load rooms'));
      const rooms = (await res.json()) as RoomSummary[];
      set({ rooms, isLoading: false });
      rememberE2eeRooms(rooms);
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : 'Failed to load rooms',
        isLoading: false,
      });
    }
  },

  // T10: the rooms list may have been fetched before an admin enabled E2EE,
  // so its cached currentKeyId can't decide plaintext vs E2EE on entry. This
  // re-reads it from the server (GET /rooms — there is no single-room GET,
  // and the list is small) and reports the outcome per room; until it
  // settles, useRoomE2eeState reads 'unknown' and the composer stays gated.
  // Not routed through fetchRooms: its overlap guard returns early without a
  // result, which would leave this room's state undecided.
  refreshRoom: (name: string) => {
    const existing = refreshesInFlight.get(name);
    if (existing) return existing;

    const setRefresh = (state: RoomRefreshState) =>
      set((s) => ({ refreshByRoom: { ...s.refreshByRoom, [name]: state } }));

    const run = (async () => {
      setRefresh({ status: 'pending' });
      const everE2ee = await e2eeSticky.wasEverE2ee(name);
      set((s) => ({ everE2eeByRoom: { ...s.everE2eeByRoom, [name]: everE2ee || !!s.everE2eeByRoom[name] } }));
      try {
        const token = useAuthStore.getState().token;
        if (!token) throw new Error('Not authenticated');
        const res = await fetch(`${API}/rooms`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error(await extractErrorMessage(res, 'Failed to load rooms'));
        const rooms = (await res.json()) as RoomSummary[];
        set({ rooms });
        rememberE2eeRooms(rooms);
        const room = rooms.find((r) => r.name === name);
        // Missing = not (or no longer) a member; the sync socket reports that
        // separately (4003). Treated like a failed refresh here.
        setRefresh(room ? { status: 'ok', currentKeyId: room.currentKeyId } : { status: 'failed' });
      } catch {
        setRefresh({ status: 'failed' });
      }
    })().finally(() => refreshesInFlight.delete(name));

    refreshesInFlight.set(name, run);
    return run;
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
