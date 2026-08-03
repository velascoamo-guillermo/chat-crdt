import { describe, test, expect } from 'bun:test';
import { formatMarkdownReport, type ReportRow } from './report';

function row(overrides: Partial<ReportRow> = {}): ReportRow {
  return {
    topology: '2 clients — same instance',
    condition: 'baseline',
    summary: { count: 100, p50: 2, p95: 4, p99: 6, min: 0, max: 7, meanMs: 2.5 },
    deliveredSamples: 100,
    expectedSamples: 100,
    achievedRatePerSec: 9.8,
    failed: false,
    ...overrides,
  };
}

describe('formatMarkdownReport', () => {
  test('renders a header, divider, and one row per input, with an "ok" status', () => {
    const md = formatMarkdownReport([row()]);
    const lines = md.split('\n');
    expect(lines[0]).toContain('Delivered/Expected');
    expect(lines[0]).toContain('Achieved Rate');
    expect(lines[0]).toContain('Status');
    expect(lines[1]).toMatch(/^\|---\|/);
    expect(lines[2]).toContain('2 clients — same instance');
    expect(lines[2]).toContain('baseline');
    expect(lines[2]).toContain('100/100');
    expect(lines[2]).toContain('9.8');
    expect(lines[2]).toContain('| ok |');
  });

  test('marks a short delivery as FAILED', () => {
    const md = formatMarkdownReport([row({ deliveredSamples: 80, expectedSamples: 100, failed: true })]);
    expect(md).toContain('80/100');
    expect(md).toContain('| FAILED |');
  });

  test('renders one line per row, in input order', () => {
    const md = formatMarkdownReport([
      row({ condition: 'baseline' }),
      row({ condition: 'burst' }),
    ]);
    const dataLines = md.split('\n').slice(2);
    expect(dataLines).toHaveLength(2);
    expect(dataLines[0]).toContain('baseline');
    expect(dataLines[1]).toContain('burst');
  });
});
