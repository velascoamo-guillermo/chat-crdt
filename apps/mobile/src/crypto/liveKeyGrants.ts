/**
 * T16: live key grants for one open E2EE room, so a gated member unlocks
 * without anyone re-opening the room.
 *
 * Primary path is server push over the room's sync socket:
 * - a gated member sends KEY_REQUEST; the server relays it to the other
 *   members' sockets in the room, and any device holding the key serves the
 *   pending grants (ADR-010 first-responder, unchanged);
 * - the server then sends KEY_GRANTED to the recipient's sockets only, and
 *   the member loads its grants.
 *
 * Safety net while gated: re-check (load grants, then ask again) with capped
 * exponential backoff, a bounded number of times. It covers frames lost to a
 * socket blip or Redis pub/sub (at-most-once), and is restarted on every
 * reconnect. It only ever adds keys to the cipher, so it can't flip a ready
 * composer back to gated, and it never sends anything without a key.
 *
 * Pure, timer-injected logic; useE2ee wires it to the real flows.
 */

export interface LiveKeyGrantsDeps {
  /** Serve pending grants for other members (first-responder wrap). */
  serve: () => Promise<unknown>;
  /** Load this user's grants into the room cipher and refresh its pending set. */
  load: () => Promise<unknown>;
  /** Send KEY_REQUEST on the room socket; false if it couldn't be sent. */
  request: () => boolean;
  /** Whether this device can encrypt at the room's current epoch. */
  isReady: () => boolean;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export interface LiveKeyGrantsOptions {
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Re-checks per gated stretch (start or reconnect); push still works after. */
  maxAttempts?: number;
}

export interface LiveKeyGrants {
  /** Call once the room's initial key load is done. */
  start(): void;
  /** Server relayed another member's KEY_REQUEST. */
  onKeyRequested(): void;
  /** Server says a grant for this user landed. */
  onKeyGranted(): void;
  /** The room socket (re)connected. */
  onReconnected(): void;
  /** Leaving the room (or rebuilding the cipher): no further work. */
  stop(): void;
}

/** Runs `fn` one at a time; calls made meanwhile collapse into one trailing run. */
function singleFlight(fn: () => Promise<unknown>, isStopped: () => boolean): () => Promise<void> {
  let running: Promise<void> | null = null;
  let again = false;
  const run = (): Promise<void> => {
    if (isStopped()) return Promise.resolve();
    if (running) {
      again = true;
      return running;
    }
    running = fn()
      .then(
        () => undefined,
        () => undefined, // best-effort, like the rest of the key flows
      )
      .finally(() => {
        running = null;
        if (again) {
          again = false;
          void run();
        }
      });
    return running;
  };
  return run;
}

export function createLiveKeyGrants(deps: LiveKeyGrantsDeps, opts: LiveKeyGrantsOptions = {}): LiveKeyGrants {
  const baseDelayMs = opts.baseDelayMs ?? 2_000;
  const maxDelayMs = opts.maxDelayMs ?? 30_000;
  const maxAttempts = opts.maxAttempts ?? 8;
  const setTimer = deps.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimer ?? ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>));

  let stopped = false;
  let attempts = 0;
  let timer: unknown = null;
  const isStopped = () => stopped;

  const serve = singleFlight(deps.serve, isStopped);
  const load = singleFlight(deps.load, isStopped);

  const cancelTimer = () => {
    if (timer !== null) clearTimer(timer);
    timer = null;
  };

  const schedule = () => {
    cancelTimer();
    if (stopped || attempts >= maxAttempts) return;
    const delay = Math.min(baseDelayMs * 2 ** attempts, maxDelayMs);
    attempts++;
    timer = setTimer(() => {
      timer = null;
      void recheck();
    }, delay);
  };

  const recheck = async () => {
    await load();
    if (stopped || deps.isReady()) return;
    if (attempts >= maxAttempts) return;
    deps.request();
    schedule();
  };

  const askWhileGated = () => {
    if (stopped || deps.isReady()) return;
    attempts = 0;
    deps.request();
    schedule();
  };

  return {
    start: askWhileGated,
    onReconnected: askWhileGated,
    onKeyRequested() {
      void serve();
    },
    onKeyGranted() {
      void load().then(() => {
        if (!stopped && deps.isReady()) cancelTimer();
      });
    },
    stop() {
      stopped = true;
      cancelTimer();
    },
  };
}
