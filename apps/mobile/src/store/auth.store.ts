import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import type { UserDto, AuthResponse } from '@chat-crdt/shared';

const API = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3001';
const TOKEN_KEY = 'auth_token';

interface AuthState {
  token: string | null;
  user: UserDto | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  loadFromStorage: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  token: null,
  user: null,
  isLoading: true,

  loadFromStorage: async () => {
    try {
      const raw = await SecureStore.getItemAsync(TOKEN_KEY);
      if (raw) {
        const { token, user } = JSON.parse(raw) as AuthResponse;
        set({ token, user, isLoading: false });
        return;
      }
    } catch {
      // ignore corrupt storage
    }
    set({ isLoading: false });
  },

  login: async (email, password) => {
    const res = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error((body as any).message ?? 'Login failed');
    }
    const data: AuthResponse = await res.json();
    await SecureStore.setItemAsync(TOKEN_KEY, JSON.stringify(data));
    set({ token: data.token, user: data.user });
  },

  register: async (email, username, password) => {
    const res = await fetch(`${API}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, username, password }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error((body as any).message ?? 'Register failed');
    }
    const data: AuthResponse = await res.json();
    await SecureStore.setItemAsync(TOKEN_KEY, JSON.stringify(data));
    set({ token: data.token, user: data.user });
  },

  logout: async () => {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
    set({ token: null, user: null });
  },
}));
