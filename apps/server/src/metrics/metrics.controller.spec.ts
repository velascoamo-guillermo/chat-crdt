import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';

describe('MetricsController', () => {
  it('returns prom-client text output with its content type', async () => {
    const metrics = new MetricsService();
    metrics.incWsConnections();
    const controller = new MetricsController(metrics);

    const body = await controller.getMetrics();

    expect(body).toContain('ws_connections 1');
    expect(controller.getContentType()).toContain('text/plain');
  });
});
