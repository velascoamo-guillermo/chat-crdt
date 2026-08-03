import type { LatencySummary } from './percentiles';

export interface ReportRow {
  topology: string;
  condition: string;
  summary: LatencySummary;
}

/** Renders the topology x condition results as a GitHub-flavored markdown table. */
export function formatMarkdownReport(rows: readonly ReportRow[]): string {
  const header = '| Topology | Condition | Samples | P50 (ms) | P95 (ms) | P99 (ms) | Min / Max (ms) |';
  const divider = '|---|---|---|---|---|---|---|';
  const body = rows.map(row => {
    const { summary } = row;
    return `| ${row.topology} | ${row.condition} | ${summary.count} | ${summary.p50.toFixed(1)} | ${summary.p95.toFixed(1)} | ${summary.p99.toFixed(1)} | ${summary.min.toFixed(1)} / ${summary.max.toFixed(1)} |`;
  });
  return [header, divider, ...body].join('\n');
}
