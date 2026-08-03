import type { LatencySummary } from './percentiles';

export interface ReportRow {
  topology: string;
  condition: string;
  summary: LatencySummary;
  deliveredSamples: number;
  expectedSamples: number;
  achievedRatePerSec: number;
  /** True if delivered < expected, or the server rate-limited a client mid-run. */
  failed: boolean;
}

/** Renders the topology x condition results as a GitHub-flavored markdown table. */
export function formatMarkdownReport(rows: readonly ReportRow[]): string {
  const header =
    '| Topology | Condition | Delivered/Expected | Achieved Rate (msg/s) | P50 (ms) | P95 (ms) | P99 (ms) | Min / Max (ms) | Status |';
  const divider = '|---|---|---|---|---|---|---|---|---|';
  const body = rows.map(row => {
    const { summary } = row;
    const status = row.failed ? 'FAILED' : 'ok';
    return `| ${row.topology} | ${row.condition} | ${row.deliveredSamples}/${row.expectedSamples} | ${row.achievedRatePerSec.toFixed(1)} | ${summary.p50.toFixed(1)} | ${summary.p95.toFixed(1)} | ${summary.p99.toFixed(1)} | ${summary.min.toFixed(1)} / ${summary.max.toFixed(1)} | ${status} |`;
  });
  return [header, divider, ...body].join('\n');
}
