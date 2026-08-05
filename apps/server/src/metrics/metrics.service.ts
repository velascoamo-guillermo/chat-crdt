import { Injectable } from '@nestjs/common';
import { Registry, Counter, Gauge, Histogram, collectDefaultMetrics } from 'prom-client';

export type MessageType = 'sync' | 'awareness';

/**
 * Prometheus metrics for the sync server, scraped cluster-internally at
 * GET /metrics (see MetricsController — no JWT guard, not exposed on public
 * ingress).
 *
 * Cardinality caveat: `yjs_state_bytes` is labeled by `roomId`. That is
 * bounded-but-unbounded — one series per *currently loaded* room on this
 * instance, not per room ever created (rooms are GC'd from memory
 * ROOM_GC_DELAY_MS after the last client leaves, see SyncGateway). Acceptable
 * at MVP scale (tens–hundreds of concurrent rooms); if the room count grows
 * into the thousands this should move to a histogram of state sizes instead
 * of a per-room gauge.
 */
@Injectable()
export class MetricsService {
  readonly registry = new Registry();

  private readonly wsConnections = new Gauge({
    name: 'ws_connections',
    help: 'Current number of open WebSocket connections on this instance',
    registers: [this.registry],
  });

  private readonly roomsLoaded = new Gauge({
    name: 'rooms_loaded',
    help: 'Current number of rooms held in memory on this instance',
    registers: [this.registry],
  });

  private readonly messagesTotal = new Counter({
    name: 'messages_total',
    help: 'Total sync/awareness WebSocket messages processed',
    labelNames: ['type'] as const,
    registers: [this.registry],
  });

  private readonly fanoutBytesTotal = new Counter({
    name: 'fanout_bytes_total',
    help: 'Total bytes published to Redis for cross-instance fan-out',
    registers: [this.registry],
  });

  private readonly persistDuration = new Histogram({
    name: 'persist_duration_seconds',
    help: 'Duration of yjsState persistence to Postgres, in seconds',
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [this.registry],
  });

  // See class-level cardinality caveat: single `roomId` label, bounded by
  // in-memory loaded-room count.
  private readonly yjsStateBytes = new Gauge({
    name: 'yjs_state_bytes',
    help: 'Persisted yjsState size in bytes per room (ADR-009 1MB compaction trigger)',
    labelNames: ['roomId'] as const,
    registers: [this.registry],
  });

  constructor() {
    collectDefaultMetrics({ register: this.registry });
  }

  incWsConnections(): void {
    this.wsConnections.inc();
  }

  decWsConnections(): void {
    this.wsConnections.dec();
  }

  incRoomsLoaded(): void {
    this.roomsLoaded.inc();
  }

  decRoomsLoaded(): void {
    this.roomsLoaded.dec();
  }

  incMessages(type: MessageType): void {
    this.messagesTotal.inc({ type });
  }

  incFanoutBytes(bytes: number): void {
    this.fanoutBytesTotal.inc(bytes);
  }

  observePersistDurationSeconds(seconds: number): void {
    this.persistDuration.observe(seconds);
  }

  setYjsStateBytes(roomId: string, bytes: number): void {
    this.yjsStateBytes.set({ roomId }, bytes);
  }

  getMetricsText(): Promise<string> {
    return this.registry.metrics();
  }

  getContentType(): string {
    return this.registry.contentType;
  }
}
