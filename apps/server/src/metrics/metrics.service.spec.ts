import { MetricsService } from './metrics.service';

describe('MetricsService', () => {
  let metrics: MetricsService;

  beforeEach(() => {
    metrics = new MetricsService();
  });

  it('exposes prom-client text format including all required metric names', async () => {
    const text = await metrics.getMetricsText();

    expect(text).toContain('# TYPE ws_connections gauge');
    expect(text).toContain('# TYPE rooms_loaded gauge');
    expect(text).toContain('# TYPE messages_total counter');
    expect(text).toContain('# TYPE fanout_bytes_total counter');
    expect(text).toContain('# TYPE persist_duration_seconds histogram');
    expect(text).toContain('# TYPE yjs_state_bytes gauge');
  });

  it('increments and decrements the ws_connections gauge', async () => {
    metrics.incWsConnections();
    metrics.incWsConnections();
    metrics.decWsConnections();

    const text = await metrics.getMetricsText();
    expect(text).toContain('ws_connections 1');
  });

  it('increments and decrements the rooms_loaded gauge', async () => {
    metrics.incRoomsLoaded();
    metrics.incRoomsLoaded();
    metrics.decRoomsLoaded();

    const text = await metrics.getMetricsText();
    expect(text).toContain('rooms_loaded 1');
  });

  it('increments messages_total labeled by message type', async () => {
    metrics.incMessages('sync');
    metrics.incMessages('sync');
    metrics.incMessages('awareness');

    const text = await metrics.getMetricsText();
    expect(text).toContain('messages_total{type="sync"} 2');
    expect(text).toContain('messages_total{type="awareness"} 1');
  });

  it('increments fanout_bytes_total by the given byte count', async () => {
    metrics.incFanoutBytes(120);
    metrics.incFanoutBytes(30);

    const text = await metrics.getMetricsText();
    expect(text).toContain('fanout_bytes_total 150');
  });

  it('records persist_duration_seconds observations', async () => {
    metrics.observePersistDurationSeconds(0.05);

    const text = await metrics.getMetricsText();
    expect(text).toContain('persist_duration_seconds_count 1');
  });

  it('sets yjs_state_bytes per roomId label', async () => {
    metrics.setYjsStateBytes('room-a', 512_000);

    const text = await metrics.getMetricsText();
    expect(text).toContain('yjs_state_bytes{roomId="room-a"} 512000');
  });

  it('reports the prom-client content type for the /metrics response header', () => {
    expect(metrics.getContentType()).toContain('text/plain');
  });
});
