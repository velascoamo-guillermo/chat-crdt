import { Controller, Get, Header } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { MetricsService } from './metrics.service';

/**
 * Cluster-internal Prometheus scrape endpoint. Intentionally has NO JwtAuthGuard
 * — Prometheus scrapes it directly over the ClusterIP Service, unauthenticated.
 * This is safe only because it must never be routed through a public Ingress;
 * see infra/k8s/README.md for the ingress exclusion note.
 *
 * @SkipThrottle() — the global ThrottlerGuard (AppModule) counts against a
 * 100 req/60s per-IP budget. A 15s Prometheus scrape interval is nowhere
 * near that, but readiness/liveness probes hit this same endpoint too and
 * all pods currently share the pod-network IP as seen by kube-proxy in some
 * CNI setups — skip throttling here rather than risk probes and scrapes
 * competing for the same budget as real traffic.
 */
@SkipThrottle()
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
