import { describe, it, expect, beforeEach } from 'bun:test';
import type { RoomRefreshState } from './roomE2eeState';
import {
  createLatestWins,
  createRoomRefresher,
  type RoomRefresherDeps,
  type RoomsFetchResult,
} from './roomRefresher';

type Room = { name: string; currentKeyId: number };

/** Manual promise, so a test decides when (and in which order) fetches settle. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

function harness() {
  const fetches: ReturnType<typeof deferred<RoomsFetchResult<Room>>>[] = [];
  const states: [string, RoomRefreshState | undefined][] = [];
  const timers: { fn: () => void; ms: number; cleared: boolean }[] = [];
  const applied: Room[][] = [];
  const everE2ee: string[] = [];
  let socket: 'connected' | 'connecting' | 'disconnected' | undefined = 'disconnected';
  let sticky = false;

  const deps: RoomRefresherDeps<Room> = {
    fetchRooms: () => {
      const d = deferred<RoomsFetchResult<Room>>();
      fetches.push(d);
      return d.promise;
    },
    socketState: () => socket,
    wasEverE2ee: async () => sticky,
    onEverE2ee: (room) => everE2ee.push(room),
    onRooms: (rooms) => applied.push(rooms),
    onRefresh: (room, state) => states.push([room, state]),
    setTimer: (fn, ms) => {
      const t = { fn, ms, cleared: false };
      timers.push(t);
      return t;
    },
    clearTimer: (handle) => {
      (handle as { cleared: boolean }).cleared = true;
    },
  };
  const refresher = createRoomRefresher(deps);
  const lastState = (room = 'team-a') => [...states].reverse().find(([r]) => r === room)?.[1];
  /** Let the refresher's awaits (sticky read, fetch) run. */
  const flush = () => new Promise((r) => setTimeout(r, 0));
  return {
    refresher,
    fetches,
    states,
    timers,
    applied,
    everE2ee,
    lastState,
    flush,
    setSocket: (v: typeof socket) => (socket = v),
    setSticky: (v: boolean) => (sticky = v),
  };
}

describe('createRoomRefresher (T10: authoritative per-room E2EE refresh)', () => {
  let h: ReturnType<typeof harness>;
  beforeEach(() => {
    h = harness();
  });

  it('goes pending, then ok with the server epoch, and applies the rooms list', async () => {
    const run = h.refresher.refresh('team-a');
    expect(h.lastState()).toEqual({ status: 'pending' });
    await h.flush();
    h.fetches[0].resolve({ kind: 'ok', rooms: [{ name: 'team-a', currentKeyId: 2 }] });
    await run;

    expect(h.lastState()).toEqual({ status: 'ok', currentKeyId: 2 });
    expect(h.applied).toEqual([[{ name: 'team-a', currentKeyId: 2 }]]);
  });

  it('reports the persisted ever-E2EE flag', async () => {
    h.setSticky(true);
    const run = h.refresher.refresh('team-a');
    await h.flush();
    h.fetches[0].resolve({ kind: 'ok', rooms: [{ name: 'team-a', currentKeyId: 0 }] });
    await run;

    expect(h.everE2ee).toEqual(['team-a']);
  });

  describe('failure classification (review I2)', () => {
    async function refreshWith(result: RoomsFetchResult<Room> | Error) {
      const run = h.refresher.refresh('team-a');
      await h.flush();
      const d = h.fetches[0];
      if (result instanceof Error) {
        // fetchRooms itself rejecting is a network failure too.
        (d as unknown as { resolve: (v: unknown) => void }).resolve(Promise.reject(result));
      } else {
        d.resolve(result);
      }
      await run;
      return h.lastState();
    }

    it('HTTP 5xx -> error (never plaintext)', async () => {
      expect(await refreshWith({ kind: 'http-error', status: 503 })).toEqual({ status: 'error' });
    });

    it('HTTP 401 -> error', async () => {
      expect(await refreshWith({ kind: 'http-error', status: 401 })).toEqual({ status: 'error' });
    });

    it('room missing from the list -> error', async () => {
      expect(await refreshWith({ kind: 'ok', rooms: [{ name: 'other', currentKeyId: 0 }] })).toEqual({
        status: 'error',
      });
    });

    it('network error while the sync socket is up -> error (a blip, not offline)', async () => {
      h.setSocket('connected');
      expect(await refreshWith({ kind: 'network-error' })).toEqual({ status: 'error' });
    });

    it('network error with the sync socket down -> offline', async () => {
      h.setSocket('disconnected');
      expect(await refreshWith({ kind: 'network-error' })).toEqual({ status: 'offline' });
    });

    // Review fix 1 minor: at room entry the socket is not up YET; a thrown
    // fetch then (DNS/TLS/API host down) must not unlock plaintext.
    it('network error while the socket is still connecting -> error', async () => {
      h.setSocket('connecting');
      expect(await refreshWith({ kind: 'network-error' })).toEqual({ status: 'error' });
    });

    it('network error before the socket exists -> error', async () => {
      h.setSocket(undefined);
      expect(await refreshWith({ kind: 'network-error' })).toEqual({ status: 'error' });
    });

    it('fetchRooms throwing with the socket down -> offline', async () => {
      expect(await refreshWith(new Error('boom'))).toEqual({ status: 'offline' });
    });
  });

  it('dedupes concurrent refreshes of the same room into one fetch', async () => {
    const a = h.refresher.refresh('team-a');
    const b = h.refresher.refresh('team-a');
    await h.flush();
    h.fetches[0].resolve({ kind: 'ok', rooms: [{ name: 'team-a', currentKeyId: 0 }] });
    await Promise.all([a, b]);

    expect(h.fetches).toHaveLength(1);
  });

  describe('retry with backoff', () => {
    async function failOnce(index: number) {
      await h.flush();
      h.fetches[index].resolve({ kind: 'http-error', status: 500 });
      await h.flush();
    }

    it('retries a failed refresh with exponential backoff, capped', async () => {
      void h.refresher.refresh('team-a');
      await failOnce(0);
      expect(h.timers.map((t) => t.ms)).toEqual([1000]);

      h.timers[0].fn();
      await failOnce(1);
      h.timers[1].fn();
      await failOnce(2);
      expect(h.timers.map((t) => t.ms)).toEqual([1000, 2000, 4000]);

      for (let i = 3; i < 8; i++) {
        h.timers[i - 1].fn();
        await failOnce(i);
      }
      expect(h.timers.at(-1)!.ms).toBe(30000);
    });

    it('stays gated (pending -> error) across retries, then settles ok', async () => {
      void h.refresher.refresh('team-a');
      await failOnce(0);
      expect(h.lastState()).toEqual({ status: 'error' });

      h.timers[0].fn();
      await h.flush();
      h.fetches[1].resolve({ kind: 'ok', rooms: [{ name: 'team-a', currentKeyId: 0 }] });
      await h.flush();

      expect(h.lastState()).toEqual({ status: 'ok', currentKeyId: 0 });
      expect(h.timers).toHaveLength(1); // no retry after success
    });

    it('a success resets the backoff', async () => {
      void h.refresher.refresh('team-a');
      await failOnce(0);
      h.timers[0].fn();
      await h.flush();
      h.fetches[1].resolve({ kind: 'ok', rooms: [{ name: 'team-a', currentKeyId: 0 }] });
      await h.flush();

      void h.refresher.refresh('team-a');
      await failOnce(2);
      expect(h.timers.at(-1)!.ms).toBe(1000);
    });
  });

  describe('stop (leaving the room)', () => {
    it('clears the room state so re-entry starts unknown, not with the last result (no stale ready frame)', async () => {
      const run = h.refresher.refresh('team-a');
      await h.flush();
      h.fetches[0].resolve({ kind: 'ok', rooms: [{ name: 'team-a', currentKeyId: 0 }] });
      await run;

      h.refresher.stop('team-a');

      expect(h.lastState()).toBeUndefined();
    });

    it('cancels a scheduled retry', async () => {
      void h.refresher.refresh('team-a');
      await h.flush();
      h.fetches[0].resolve({ kind: 'http-error', status: 500 });
      await h.flush();

      h.refresher.stop('team-a');

      expect(h.timers[0].cleared).toBe(true);
    });

    it('ignores a fetch that settles after the room was left', async () => {
      const run = h.refresher.refresh('team-a');
      await h.flush();
      h.refresher.stop('team-a');
      h.fetches[0].resolve({ kind: 'ok', rooms: [{ name: 'team-a', currentKeyId: 0 }] });
      await run;

      expect(h.lastState()).toBeUndefined();
      expect(h.timers).toHaveLength(0);
    });

    it('a re-entry while the old fetch is still in flight starts its own refresh', async () => {
      void h.refresher.refresh('team-a');
      await h.flush();
      h.refresher.stop('team-a');

      const run = h.refresher.refresh('team-a');
      await h.flush();
      expect(h.fetches).toHaveLength(2);
      h.fetches[1].resolve({ kind: 'ok', rooms: [{ name: 'team-a', currentKeyId: 4 }] });
      await run;

      expect(h.lastState()).toEqual({ status: 'ok', currentKeyId: 4 });
    });
  });
});

describe('createLatestWins (rooms list: an older response never overwrites a newer one)', () => {
  it('applies responses in request order and drops one that started earlier but settled later', () => {
    const latest = createLatestWins();
    const older = latest.begin();
    const newer = latest.begin();

    expect(latest.tryApply(newer)).toBe(true);
    expect(latest.tryApply(older)).toBe(false);
  });

  it('applies sequential requests', () => {
    const latest = createLatestWins();
    expect(latest.tryApply(latest.begin())).toBe(true);
    expect(latest.tryApply(latest.begin())).toBe(true);
  });
});
