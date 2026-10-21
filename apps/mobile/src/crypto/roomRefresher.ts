import type { RoomRefreshState } from './roomE2eeState';

/**
 * T10: the authoritative per-room summary refresh behind useRoomE2eeState,
 * kept free of zustand/fetch/SecureStore so it can be unit-tested. The rooms
 * store wires the real dependencies in (rooms.store.ts).
 */

export interface RoomSummaryLike {
  name: string;
  currentKeyId: number;
}

export type RoomsFetchResult<R extends RoomSummaryLike> =
  | { kind: 'ok'; rooms: R[] }
  /** The server answered with a non-2xx status. */
  | { kind: 'http-error'; status: number }
  /** No response at all (fetch threw). */
  | { kind: 'network-error' };

export interface RoomRefresherDeps<R extends RoomSummaryLike> {
  fetchRooms(): Promise<RoomsFetchResult<R>>;
  /** The room's sync socket status; undefined = no socket yet. */
  socketState(room: string): 'connected' | 'connecting' | 'disconnected' | undefined;
  wasEverE2ee(room: string): Promise<boolean>;
  /** The persisted ever-E2EE flag reads true for this room. */
  onEverE2ee(room: string): void;
  /** A fresh rooms list arrived. */
  onRooms(rooms: R[]): void;
  /** undefined = no refresh for this room (left it) — reads as 'unknown'. */
  onRefresh(room: string, state: RoomRefreshState | undefined): void;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
}

export interface RoomRefresher {
  /** Refresh now (deduped while one is in flight); retries on failure until stop(). */
  refresh(room: string): Promise<void>;
  /** The room screen went away: cancel retries, drop late results, forget the state. */
  stop(room: string): void;
}

const BASE_RETRY_MS = 1_000;
const MAX_RETRY_MS = 30_000;

interface RoomEntry {
  /** Bumped by stop(): results from an older generation are dropped. */
  generation: number;
  inFlight: Promise<void> | null;
  retryTimer: unknown;
  failures: number;
}

export function createRoomRefresher<R extends RoomSummaryLike>(deps: RoomRefresherDeps<R>): RoomRefresher {
  const entries = new Map<string, RoomEntry>();

  const entryFor = (room: string): RoomEntry => {
    let entry = entries.get(room);
    if (!entry) {
      entry = { generation: 0, inFlight: null, retryTimer: null, failures: 0 };
      entries.set(room, entry);
    }
    return entry;
  };

  // Only "no response AND the socket has failed too" counts as offline
  // (review I2). An HTTP error, a blip while the socket is up, the room
  // missing from the list, or a socket not tried/settled yet (room entry) says
  // nothing about the room's E2EE state — the retry classifies again once the
  // socket has actually failed.
  const classify = (room: string, result: RoomsFetchResult<R>): RoomRefreshState => {
    if (result.kind === 'ok') {
      const summary = result.rooms.find((r) => r.name === room);
      return summary ? { status: 'ok', currentKeyId: summary.currentKeyId } : { status: 'error' };
    }
    if (result.kind === 'network-error' && deps.socketState(room) === 'disconnected') return { status: 'offline' };
    return { status: 'error' };
  };

  const refresh = (room: string): Promise<void> => {
    const entry = entryFor(room);
    if (entry.inFlight) return entry.inFlight;
    if (entry.retryTimer !== null) {
      deps.clearTimer(entry.retryTimer);
      entry.retryTimer = null;
    }
    const generation = entry.generation;
    const isCurrent = () => entries.get(room) === entry && entry.generation === generation;

    deps.onRefresh(room, { status: 'pending' });
    const run = (async () => {
      if (await deps.wasEverE2ee(room)) deps.onEverE2ee(room);
      let result: RoomsFetchResult<R>;
      try {
        result = await deps.fetchRooms();
      } catch {
        result = { kind: 'network-error' };
      }
      if (!isCurrent()) return;
      if (result.kind === 'ok') deps.onRooms(result.rooms);
      const state = classify(room, result);
      deps.onRefresh(room, state);
      if (state.status === 'ok') {
        entry.failures = 0;
        return;
      }
      // Keep trying while the room is open; offline too, so the room can
      // leave the plaintext fallback as soon as the server is reachable.
      const delay = Math.min(BASE_RETRY_MS * 2 ** entry.failures, MAX_RETRY_MS);
      entry.failures++;
      entry.retryTimer = deps.setTimer(() => {
        entry.retryTimer = null;
        if (isCurrent()) void refresh(room);
      }, delay);
    })().finally(() => {
      if (entry.inFlight === run) entry.inFlight = null;
    });
    entry.inFlight = run;
    return run;
  };

  const stop = (room: string): void => {
    const entry = entries.get(room);
    if (entry?.retryTimer !== null && entry?.retryTimer !== undefined) deps.clearTimer(entry.retryTimer);
    entries.delete(room);
    deps.onRefresh(room, undefined);
  };

  return { refresh, stop };
}

/**
 * Request sequencing for the rooms list: two GET /rooms can overlap (rooms
 * screen + per-room refresh), and the one that started earlier must not
 * overwrite a newer list just because it settled later (review minor).
 */
export function createLatestWins() {
  let started = 0;
  let applied = 0;
  return {
    begin(): number {
      return ++started;
    },
    /** True if `seq` is newer than anything applied so far (and marks it applied). */
    tryApply(seq: number): boolean {
      if (seq <= applied) return false;
      applied = seq;
      return true;
    },
  };
}
