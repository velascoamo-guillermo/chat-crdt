import { create } from 'zustand';
import { useAuthStore } from './auth.store';

const API = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3001';

export interface RoomSummary {
  id: string;
  name: string;
  role: string;
}

interface ErrorBody {
  message?: string;
}

async function extractErrorMessage(res: Response, fallback: string): Promise<string> {
  const body: unknown = await res.json().catch(() => null);
  if (body && typeof body === 'object' && 'message' in body) {
    const message = (body as ErrorBody).message;
    if (typeof message === 'string') return message;
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

export const useRoomsStore = create<RoomsState>((set) => ({
  rooms: [],
  isLoading: false,
  error: null,

  fetchRooms: async () => {
    const token = useAuthStore.getState().token;
    if (!token) return;
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
