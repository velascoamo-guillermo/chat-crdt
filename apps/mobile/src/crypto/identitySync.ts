import { RoomKeyStore } from './keyStore';
import { secureStoreBackend } from './secureStoreBackend';
import { ensureIdentityPublished, type IdentityStatus } from './keyFlows';

const keyStore = new RoomKeyStore(secureStoreBackend);

/** auth.store's entry point into the identity flow, kept separate so the store stays testable without native modules. */
export function syncIdentity(apiBase: string, token: string): Promise<IdentityStatus> {
  return ensureIdentityPublished({ apiBase, token }, keyStore);
}
