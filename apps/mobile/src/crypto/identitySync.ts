import { RoomKeyStore } from './keyStore';
import { secureStoreBackend } from './secureStoreBackend';
import { ensureIdentityPublished, resetDeviceIdentity, type IdentityStatus } from './keyFlows';

const keyStore = new RoomKeyStore(secureStoreBackend);

/** auth.store's entry point into the identity flow, kept separate so the store stays testable without native modules. */
export function syncIdentity(apiBase: string, token: string): Promise<IdentityStatus> {
  return ensureIdentityPublished({ apiBase, token }, keyStore);
}

/** T15 fix 2: the user chose to replace this device's mismatched key (republishes). */
export function resetIdentity(apiBase: string, token: string): Promise<IdentityStatus> {
  return resetDeviceIdentity({ apiBase, token }, keyStore);
}
