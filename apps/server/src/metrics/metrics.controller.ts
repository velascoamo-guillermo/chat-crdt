import { Controller, Get, Header } from '@nestjs/common';
import { MetricsService } from './metrics.service';

/**
 * Cluster-internal Prometheus scrape endpoint. Intentionally has NO JwtAuthGuard
 * — Prometheus scrapes it directly over the ClusterIP Service, unauthenticated.
 * This is safe only because it must never be routed through a public Ingress;
 * see infra/k8s/README.md for the ingress exclusion note.
 */
@Controller('metrics')
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Get()
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  getMetrics(): Promise<string> {
    return this.metrics.getMetricsText();
  }

  getContentType(): string {
    return this.metrics.getContentType();
  }
}
