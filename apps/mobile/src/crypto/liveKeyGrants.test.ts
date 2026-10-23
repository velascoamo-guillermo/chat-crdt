import { describe, it, expect } from 'bun:test';
import { createLiveKeyGrants, type LiveKeyGrantsDeps } from './liveKeyGrants';

/** Manual promise, so a test decides when serve/load settle. */
function deferred() {
  let resolve!: () => void;
  let reject!: (err: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function harness(opts: { ready?: boolean; connected?: boolean } = {}) {
  let ready = opts.ready ?? false;
  let connected = opts.connected ?? true;
  const serves: ReturnType<typeof deferred>[] = [];
  const loads: ReturnType<typeof deferred>[] = [];
  const timers: { fn: () => void; ms: number; cleared: boolean }[] = [];
  let requests = 0;
  let now = 0;

  const deps: LiveKeyGrantsDeps = {
    serve: () => {
      const d = deferred();
      serves.push(d);
      return d.promise;
    },
    load: () => {
      const d = deferred();
      loads.push(d);
      return d.promise;
    },
    request: () => {
      if (!connected) return false;
      requests++;
      return true;
    },
    isReady: () => ready,
    setTimer: (fn, ms) => {
      const t = { fn, ms, cleared: false };
      timers.push(t);
      return t;
    },
    clearTimer: (handle) => {
      (handle as { cleared: boolean }).cleared = true;
    },
    now: () => now,
  };
  const live = createLiveKeyGrants(deps, {
    baseDelayMs: 2_000,
    maxDelayMs: 30_000,
    maxAttempts: 6,
    minServeIntervalMs: 5_000,
  });
  const flush = () => new Promise((r) => setTimeout(r, 0));
  const pendingTimers = () => timers.filter((t) => !t.cleared && !(t as { fired?: boolean }).fired);
  const fireNext = () => {
    const t = pendingTimers()[0];
    if (!t) throw new Error('no pending timer');
    (t as { fired?: boolean }).fired = true;
    t.fn();
  };
  return {
    live,
    serves,
    loads,
    timers,
    pendingTimers,
    fireNext,
    flush,
    requests: () => requests,
    setReady: (v: boolean) => (ready = v),
    setConnected: (v: boolean) => (connected = v),
    advance: (ms: number) => (now += ms),
  };
}

describe('createLiveKeyGrants', () => {
  it('does nothing on start when the device already holds the current key', () => {
    const h = harness({ ready: true });
    h.live.start();
    expect(h.requests()).toBe(0);
    expect(h.timers).toHaveLength(0);
  });

  it('asks for the key at once when gated, and schedules a re-check', () => {
    const h = harness();
    h.live.start();
    expect(h.requests()).toBe(1);
    expect(h.pendingTimers().map((t) => t.ms)).toEqual([2_000]);
  });

  it('a re-check loads grants, asks again while still gated, and backs off (capped, bounded)', async () => {
    const h = harness();
    h.live.start();
    const delays: number[] = [h.pendingTimers()[0].ms];
    for (let i = 0; i < 10 && h.pendingTimers().length > 0; i++) {
      h.fireNext();
      h.loads.at(-1)!.resolve();
      await h.flush();
      const next = h.pendingTimers()[0];
      if (next) delays.push(next.ms);
    }
    expect(delays).toEqual([2_000, 4_000, 8_000, 16_000, 30_000, 30_000]);
    expect(h.loads).toHaveLength(6);
    expect(h.requests()).toBe(1 + 5); // the start, then after each re-check but the last
    expect(h.pendingTimers()).toHaveLength(0);
  });

  it('stops re-checking once a load makes it ready', async () => {
    const h = harness();
    h.live.start();
    h.fireNext();
    h.setReady(true);
    h.loads[0].resolve();
    await h.flush();
    expect(h.requests()).toBe(1);
    expect(h.pendingTimers()).toHaveLength(0);
  });

  it('a KEY_GRANTED notice loads grants and cancels the pending re-check once ready', async () => {
    const h = harness();
    h.live.start();
    h.live.onKeyGranted();
    expect(h.loads).toHaveLength(1);
    h.setReady(true);
    h.loads[0].resolve();
    await h.flush();
    expect(h.pendingTimers()).toHaveLength(0);
  });

  it('coalesces KEY_REQUEST relays: one serve in flight plus at most one trailing serve', async () => {
    const h = harness({ ready: true });
    h.live.onKeyRequested();
    h.live.onKeyRequested();
    h.live.onKeyRequested();
    expect(h.serves).toHaveLength(1);
    h.advance(6_000);
    h.serves[0].resolve();
    await h.flush();
    expect(h.serves).toHaveLength(2);
    h.serves[1].resolve();
    await h.flush();
    expect(h.serves).toHaveLength(2);
  });

  it('serves for KEY_REQUEST at most once per interval per room; the last request still gets a trailing serve', async () => {
    const h = harness({ ready: true });
    h.live.onKeyRequested();
    h.serves[0].resolve();
    await h.flush();

    h.advance(1_000);
    h.live.onKeyRequested();
    h.live.onKeyRequested();
    expect(h.serves).toHaveLength(1);
    const trailing = h.pendingTimers();
    expect(trailing.map((t) => t.ms)).toEqual([4_000]);

    h.advance(4_000);
    h.fireNext();
    expect(h.serves).toHaveLength(2);
  });

  it('serves at once when the interval has already passed', async () => {
    const h = harness({ ready: true });
    h.live.onKeyRequested();
    h.serves[0].resolve();
    await h.flush();
    h.advance(5_000);
    h.live.onKeyRequested();
    expect(h.serves).toHaveLength(2);
  });

  it('stop cancels a pending trailing serve', async () => {
    const h = harness({ ready: true });
    h.live.onKeyRequested();
    h.serves[0].resolve();
    await h.flush();
    h.live.onKeyRequested();
    h.live.stop();
    expect(h.pendingTimers()).toHaveLength(0);
    expect(h.serves).toHaveLength(1);
  });

  it('load() and serve() share the single-flight runs with the live signals (initial load is not doubled)', async () => {
    const h = harness();
    const initial = h.live.load();
    h.live.onKeyGranted();
    expect(h.loads).toHaveLength(1);
    h.loads[0].resolve();
    await initial;
    await h.flush();
    expect(h.loads).toHaveLength(2); // one trailing run for the grant notice, not one per caller

    const initialServe = h.live.serve();
    h.live.onKeyRequested();
    expect(h.serves).toHaveLength(1);
    h.serves[0].resolve();
    await initialServe;
  });

  it('a failed serve or load does not throw and does not stop the re-checks', async () => {
    const h = harness();
    h.live.start();
    h.live.onKeyRequested();
    h.serves[0].reject(new Error('503'));
    h.fireNext();
    h.loads[0].reject(new Error('offline'));
    await h.flush();
    expect(h.pendingTimers().map((t) => t.ms)).toEqual([4_000]);
  });

  it('keeps re-checking when the request could not be sent (socket down)', () => {
    const h = harness({ connected: false });
    h.live.start();
    expect(h.requests()).toBe(0);
    expect(h.pendingTimers()).toHaveLength(1);
  });

  it('on reconnect while gated, asks again and restarts the backoff', async () => {
    const h = harness();
    h.live.start();
    h.fireNext();
    h.loads[0].resolve();
    await h.flush();
    expect(h.pendingTimers().map((t) => t.ms)).toEqual([4_000]);

    h.live.onReconnected();

    expect(h.requests()).toBe(3);
    expect(h.pendingTimers().map((t) => t.ms)).toEqual([2_000]);
  });

  it('on reconnect when ready, does nothing', () => {
    const h = harness({ ready: true });
    h.live.onReconnected();
    expect(h.requests()).toBe(0);
    expect(h.timers).toHaveLength(0);
  });

  it('after stop, clears its timer and ignores every later signal', async () => {
    const h = harness();
    h.live.start();
    h.live.stop();
    expect(h.pendingTimers()).toHaveLength(0);
    h.live.onKeyGranted();
    h.live.onKeyRequested();
    h.live.onReconnected();
    h.live.start();
    expect(h.loads).toHaveLength(0);
    expect(h.serves).toHaveLength(0);
    expect(h.requests()).toBe(1);
  });

  it('a load that settles after stop schedules nothing', async () => {
    const h = harness();
    h.live.start();
    h.fireNext();
    h.live.stop();
    h.loads[0].resolve();
    await h.flush();
    expect(h.pendingTimers()).toHaveLength(0);
    expect(h.requests()).toBe(1);
  });
});
