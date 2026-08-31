/**
 * Drives one publish load against a publisher + N subscribers and collects
 * every subscriber's latency samples. Not unit tested (I/O-bound, driven by
 * real WS clients) — exercised for real by run.ts against docker-compose infra.
 */
import type { WsBenchClient, LatencySample } from './ws-bench-client';

export interface LoadConfig {
  /** Number of timestamped messages the publisher sends. */
  messageCount: number;
  /** Delay between publishes, ms. 0 = fire as fast as possible. */
  intervalMs: number;
  /** Max ms to wait for in-flight fan-out to finish after the last publish. */
  drainMs: number;
}

export interface LoadResult {
  samples: LatencySample[];
  /** messageCount * subscribers.length — what a lossless run should deliver. */
  expectedSamples: number;
  deliveredSamples: number;
  /** Wall-clock time spent actually publishing (excludes the drain wait). */
  publishDurationMs: number;
  /** messageCount / publishDurationMs, i.e. the real send rate this run achieved. */
  achievedRatePerSec: number;
  /** How many of {publisher, ...subscribers} were closed by the server's rate limiter (code 4029). */
  rateLimitedClients: number;
}

/** sync.gateway.ts's `client.close(4029, 'Rate limit exceeded')`. */
const RATE_LIMIT_CLOSE_CODE = 4029;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Publishes `messageCount` timestamped messages from `publisher`, spaced by
 * `intervalMs`, while every `subscriber` records a latency sample per
 * message it observes. Resolves once all expected samples have arrived or
 * `drainMs` has elapsed since the last publish, whichever comes first.
 * Never throws on a short/lossy run — callers decide pass/fail from the
 * delivered-vs-expected counts (see run.ts).
 */
export async function runLoad(
  publisher: WsBenchClient,
  subscribers: readonly WsBenchClient[],
  config: LoadConfig,
): Promise<LoadResult> {
  const samples: LatencySample[] = [];
  const expectedSamples = config.messageCount * subscribers.length;
  const unsubscribes = subscribers.map(sub => sub.observeLatencies(sample => samples.push(sample)));

  try {
    const publishStart = performance.now();
    for (let seq = 0; seq < config.messageCount; seq++) {
      publisher.publish(seq);
      if (config.intervalMs > 0) await sleep(config.intervalMs);
    }
    const publishDurationMs = performance.now() - publishStart;

    const deadline = Date.now() + config.drainMs;
    while (samples.length < expectedSamples && Date.now() < deadline) {
      await sleep(50);
    }

    const allClients: readonly WsBenchClient[] = [publisher, ...subscribers];
    const rateLimitedClients = allClients.filter(
      c => c.isClosed() && c.lastCloseCode() === RATE_LIMIT_CLOSE_CODE,
    ).length;

    return {
      samples,
      expectedSamples,
      deliveredSamples: samples.length,
      publishDurationMs,
      achievedRatePerSec: publishDurationMs > 0 ? (config.messageCount / publishDurationMs) * 1000 : 0,
      rateLimitedClients,
    };
  } finally {
    unsubscribes.forEach(unsub => unsub());
  }
}
