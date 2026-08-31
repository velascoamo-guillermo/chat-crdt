import { create } from 'zustand';
import { useAuthStore } from './auth.store';

const API = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3001';

export interface RoomSummary {
  id: string;
  name: string;
  role: string;
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

interface RoomsState {
  rooms: RoomSummary[];
  isLoading: boolean;
  error: string | null;
  fetchRooms: () => Promise<void>;
  createRoom: (name: string) => Promise<RoomSummary>;
  joinRoom: (name: string) => Promise<RoomSummary>;
}

export const useRoomsStore = create<RoomsState>((set, get) => ({
  rooms: [],
  isLoading: false,
  error: null,

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
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : 'Failed to load rooms',
        isLoading: false,
      });
    }
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
