/**
 * ADR-010 send-path gate (code review round 1, Critical #1): a room whose
 * currentKeyId > 0 is E2EE-enabled, but the local cipher goes through two
 * separate async steps before it can actually encrypt — (1) construction,
 * once `useE2eeCipher` sees currentKeyId flip 0 -> N, and (2) loading this
 * device's grant for that specific epoch (fetchAndLoadMyGrants). Sending
 * during that window used to throw an uncaught error straight out of
 * SyncEngine.sendMessage (LibsodiumContentCipher.encrypt has no current-epoch
 * key yet). The UI must never let that throw happen — this is the pure
 * decision the composer/screen gates on, kept separate from any React state
 * so it's unit-testable without the RN/Hermes runtime.
 */
export interface EpochHoldingCipher {
  hasKey(keyId: number): boolean;
}

export function isComposerReady(currentKeyId: number, cipher: EpochHoldingCipher | null): boolean {
  if (currentKeyId <= 0) return true; // room isn't E2EE-enabled — always plaintext-ready
  return cipher !== null && cipher.hasKey(currentKeyId);
}
