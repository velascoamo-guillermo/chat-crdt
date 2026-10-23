import type { IdentityStatus } from '../crypto/keyFlows';

interface IdentitySyncDeps {
  getToken: () => string | null;
  setStatus: (status: IdentityStatus) => void;
  sync: (token: string) => Promise<IdentityStatus>;
  warn: (message: string) => void;
}

/**
 * auth.store's syncIdentity action, with its dependencies injected so it
 * runs under bun without SecureStore/libsodium.
 *
 * ADR-010: a member's public key must exist before anyone can wrap a room
 * key for them, so this runs as soon as there's a token. Best-effort: a
 * failure is retried on the next token change or the next E2EE room mount
 * (useE2eeCipher runs the same flow).
 */
export function makeSyncIdentity(deps: IdentitySyncDeps): () => Promise<void> {
  return async () => {
    const token = deps.getToken();
    if (!token) return;
    try {
      const status = await deps.sync(token);
      if (deps.getToken() !== token) return; // signed out or switched account meanwhile
      if (status === 'mismatch') {
        deps.warn('E2EE: this device holds a different identity key than the one published for this account');
      }
      deps.setStatus(status);
    } catch {
      // ignore — see above
    }
  };
}
