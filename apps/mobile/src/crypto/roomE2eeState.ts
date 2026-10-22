/**
 * T10 (security): whether a room is E2EE can't be decided from the cached
 * rooms-list summary alone — a member who fetched that list before an admin
 * enabled E2EE still reads currentKeyId 0, and treating that as "plaintext"
 * let them send plaintext into an encrypted room and render envelopes as raw
 * text. Every room entry (and WS reconnect) refreshes the summary from the
 * server; until that lands the state is 'unknown', which callers must treat
 * as NOT plaintext (composer gated, envelopes not shown as text).
 *
 * Offline decision: a room cached as E2EE, or one this device has ever seen
 * as E2EE (persisted sticky flag, see e2eeStickyStore.ts), stays 'e2ee'. A
 * room never seen as E2EE may keep working as plaintext only when the device
 * is truly offline (the GET failed without a response AND the room's sync
 * socket is down — 'offline'). Messages queued then are refused by the server
 * if the room turned out to be E2EE (sync.gateway.ts); the client retracts
 * them and puts the text back in the composer (useSync onE2eeRejected).
 *
 * Any other failure — HTTP 4xx/5xx, a network error while the socket is up,
 * the room missing from the list — is 'error': it says nothing about the
 * room's E2EE state, so it stays 'unknown' (gated) while the refresh retries.
 */
export type RoomE2eeState = 'plaintext' | 'e2ee' | 'unknown';

export type RoomRefreshState =
  | { status: 'pending' }
  | { status: 'ok'; currentKeyId: number }
  /** No response and the sync socket is down: may fall back to plaintext. */
  | { status: 'offline' }
  /** Refresh failed for any other reason: never unlocks plaintext. */
  | { status: 'error' };

export interface RoomE2eeInputs {
  /** currentKeyId from the cached rooms store (possibly stale). */
  cachedKeyId: number;
  /** Authoritative per-entry refresh; undefined = not started yet (same as pending). */
  refresh: RoomRefreshState | undefined;
  /** This device has seen the room as E2EE before (currentKeyId never decreases). */
  everE2ee: boolean;
}

export function resolveRoomE2eeState({ cachedKeyId, refresh, everE2ee }: RoomE2eeInputs): RoomE2eeState {
  // Epochs only ever increase server-side, so any sighting of E2EE is final.
  if (cachedKeyId > 0 || everE2ee) return 'e2ee';
  if (!refresh || refresh.status === 'pending') return 'unknown';
  if (refresh.status === 'ok') return refresh.currentKeyId > 0 ? 'e2ee' : 'plaintext';
  if (refresh.status === 'offline') return 'plaintext'; // never seen as E2EE — see above
  return 'unknown';
}
