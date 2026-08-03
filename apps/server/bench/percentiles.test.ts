import { describe, test, expect } from 'bun:test';
import { percentile, summarizeLatenciesMs } from './percentiles';

describe('percentile', () => {
  test('interpolates P50/P95/P99 on a known 10-value dataset', () => {
    const sorted = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(percentile(sorted, 50)).toBeCloseTo(5.5, 6);
    expect(percentile(sorted, 95)).toBeCloseTo(9.55, 6);
    expect(percentile(sorted, 99)).toBeCloseTo(9.91, 6);
  });

  test('returns the single value for a one-element dataset at any p', () => {
    expect(percentile([42], 0)).toBe(42);
    expect(percentile([42], 50)).toBe(42);
    expect(percentile([42], 99)).toBe(42);
  });

  test('p=0 returns the min and p=100 returns the max', () => {
    const sorted = [3, 5, 9, 12];
    expect(percentile(sorted, 0)).toBe(3);
    expect(percentile(sorted, 100)).toBe(12);
  });

  test('throws on an empty sample set', () => {
    expect(() => percentile([], 50)).toThrow(/empty/i);
  });

  test('throws when p is outside [0, 100]', () => {
    expect(() => percentile([1, 2, 3], -1)).toThrow(/p must be within/i);
    expect(() => percentile([1, 2, 3], 101)).toThrow(/p must be within/i);
  });
});

describe('summarizeLatenciesMs', () => {
  test('computes count/min/max/mean plus P50/P95/P99', () => {
    const latencies = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    const summary = summarizeLatenciesMs(latencies);
    expect(summary.count).toBe(10);
    expect(summary.min).toBe(10);
    expect(summary.max).toBe(100);
    expect(summary.meanMs).toBeCloseTo(55, 6);
    expect(summary.p50).toBeCloseTo(55, 6);
    expect(summary.p95).toBeCloseTo(95.5, 6);
    expect(summary.p99).toBeCloseTo(99.1, 6);
  });

  test('does not mutate the input array (sorts a copy)', () => {
    const latencies = [30, 10, 20];
    summarizeLatenciesMs(latencies);
    expect(latencies).toEqual([30, 10, 20]);
  });

  test('throws on an empty sample set', () => {
    expect(() => summarizeLatenciesMs([])).toThrow(/no latency samples/i);
  });
});
