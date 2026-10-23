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
 *
 * T10: the room's E2EE state comes from resolveRoomE2eeState, not from the
 * cached currentKeyId alone (that can be stale — see roomE2eeState.ts).
 */
import type { RoomE2eeState } from './roomE2eeState';

export interface EpochHoldingCipher {
  hasKey(keyId: number): boolean;
}

export function isComposerReady(
  e2eeState: RoomE2eeState,
  currentKeyId: number,
  cipher: EpochHoldingCipher | null
): boolean {
  if (e2eeState === 'plaintext') return true; // server-confirmed E2EE-off — always plaintext-ready
  // T10: 'unknown' (summary refresh still in flight) is gated, never plaintext.
  if (e2eeState === 'unknown' || currentKeyId <= 0) return false;
  return cipher !== null && cipher.hasKey(currentKeyId);
}
