import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import type { UserDto, AuthResponse } from '@chat-crdt/shared';
import { useChatStore } from './chat.store';
import { syncIdentity } from '../crypto/identitySync';
import type { IdentityStatus } from '../crypto/keyFlows';
import { makeSyncIdentity } from './identitySession';

const API = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3001';
const TOKEN_KEY = 'auth_token';

interface AuthState {
  token: string | null;
  user: UserDto | null;
  isLoading: boolean;
  /** T15: this device's E2EE identity vs the server's for the signed-in user; null until checked. */
  identityStatus: IdentityStatus | null;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  loadFromStorage: () => Promise<void>;
  syncIdentity: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  token: null,
  user: null,
  isLoading: true,
  identityStatus: null,

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
    const data = (await res.json()) as AuthResponse;
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
    const data = (await res.json()) as AuthResponse;
    await SecureStore.setItemAsync(TOKEN_KEY, JSON.stringify(data));
    set({ token: data.token, user: data.user });
  },

  syncIdentity: makeSyncIdentity({
    getToken: () => get().token,
    setStatus: (identityStatus) => set({ identityStatus }),
    sync: (token) => syncIdentity(API, token),
    warn: (message) => console.warn(message),
  }),

  logout: async () => {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
    // T10: refused-text drafts are per account; local room docs are already
    // scoped per user (useSync), so nothing else carries over. T15: E2EE
    // keys are scoped per user too and deliberately kept, so logging back in
    // as the same user still decrypts their history.
    useChatStore.getState().clearAllE2eeRejections();
    set({ token: null, user: null, identityStatus: null });
  },
}));
