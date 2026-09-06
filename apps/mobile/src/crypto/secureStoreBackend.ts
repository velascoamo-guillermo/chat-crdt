import * as SecureStore from 'expo-secure-store';
import type { SecureKeyValueStore } from './keyStore';

/**
 * expo-secure-store adapter for RoomKeyStore. SecureStore keys must match
 * `^[A-Za-z0-9._-]+$` — the storage keys RoomKeyStore builds (roomId/keyId
 * joined with '.') already satisfy this as long as roomId itself does
 * (room names are validated lowercase-alphanumeric-plus-hyphens server-side,
 * CreateRoomDto).
 */
export const secureStoreBackend: SecureKeyValueStore = {
  getItem: (key) => SecureStore.getItemAsync(key),
  setItem: (key, value) => SecureStore.setItemAsync(key, value),
  removeItem: (key) => SecureStore.deleteItemAsync(key),
};
