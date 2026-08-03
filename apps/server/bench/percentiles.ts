/**
 * Pure percentile math for the latency bench harness. No I/O, no timers —
 * safe to unit test with `bun test` in isolation from the WS/HTTP layer.
 */

export interface LatencySummary {
  count: number;
  p50: number;
  p95: number;
  p99: number;
  min: number;
  max: number;
  meanMs: number;
}

/**
 * Linear-interpolation percentile (the "R-7" method used by numpy's default
 * and most APM tools) over an already-sorted-ascending array.
 */
export function percentile(sortedAscending: readonly number[], p: number): number {
  if (sortedAscending.length === 0) {
    throw new Error('percentile: cannot compute a percentile of an empty sample set');
  }
  if (p < 0 || p > 100) {
    throw new Error(`percentile: p must be within [0, 100], got ${p}`);
  }
  if (sortedAscending.length === 1) return sortedAscending[0];

  const rank = (p / 100) * (sortedAscending.length - 1);
  const lowerIndex = Math.floor(rank);
  const upperIndex = Math.ceil(rank);
  if (lowerIndex === upperIndex) return sortedAscending[lowerIndex];

  const weight = rank - lowerIndex;
  return (
    sortedAscending[lowerIndex] +
    (sortedAscending[upperIndex] - sortedAscending[lowerIndex]) * weight
  );
}

/** Sorts a copy of `latenciesMs` (never mutates the caller's array) and summarizes it. */
export function summarizeLatenciesMs(latenciesMs: readonly number[]): LatencySummary {
  if (latenciesMs.length === 0) {
    throw new Error('summarizeLatenciesMs: no latency samples to summarize');
  }
  const sorted = [...latenciesMs].sort((a, b) => a - b);
  const sum = sorted.reduce((total, value) => total + value, 0);

  return {
    count: sorted.length,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    min: sorted[0],
    max: sorted[sorted.length - 1],
    meanMs: sum / sorted.length,
  };
}
