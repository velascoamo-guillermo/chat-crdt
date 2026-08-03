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

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Publishes `messageCount` timestamped messages from `publisher`, spaced by
 * `intervalMs`, while every `subscriber` records a latency sample per
 * message it observes. Resolves once all expected samples have arrived or
 * `drainMs` has elapsed since the last publish, whichever comes first.
 */
export async function runLoad(
  publisher: WsBenchClient,
  subscribers: readonly WsBenchClient[],
  config: LoadConfig,
): Promise<LatencySample[]> {
  const samples: LatencySample[] = [];
  const expected = config.messageCount * subscribers.length;
  const unsubscribes = subscribers.map(sub => sub.observeLatencies(sample => samples.push(sample)));

  try {
    for (let seq = 0; seq < config.messageCount; seq++) {
      publisher.publish(seq);
      if (config.intervalMs > 0) await sleep(config.intervalMs);
    }

    const deadline = Date.now() + config.drainMs;
    while (samples.length < expected && Date.now() < deadline) {
      await sleep(50);
    }
  } finally {
    unsubscribes.forEach(unsub => unsub());
  }

  return samples;
}
