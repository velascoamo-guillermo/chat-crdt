# infra/k8s — Kustomize manifests + observability

Local validation only (kind/minikube). **Actual GKE deploy is out of scope**
(ticket #19) — costs money, and this base is written to be GKE-portable
later without rewriting it (base + overlays split, Secrets referenced by
name, image name left untagged in base).

## Layout

```
infra/k8s/
  base/                 server Deployment (2 replicas), Service, ConfigMap,
                         HPA, PodDisruptionBudget, Namespace
  overlays/local/        + dev-grade Postgres/Redis (single replica, emptyDir),
                         NodePort patch, kind-friendly imagePullPolicy patch
  monitoring/            Prometheus (kubernetes_sd_configs, no operator) +
                         Grafana (provisioned datasource + dashboard),
                         included as a resource from overlays/local
```

## Secrets — never committed

Two Secrets are referenced by name only; nothing here creates them. Run
before `kubectl apply -k`:

```sh
kubectl create namespace chat-crdt --dry-run=client -o yaml | kubectl apply -f -

kubectl create secret generic postgres-credentials -n chat-crdt \
  --from-literal=POSTGRES_USER=chatcrdt \
  --from-literal=POSTGRES_PASSWORD=<CHANGE_ME> \
  --from-literal=POSTGRES_DB=chatcrdt

kubectl create secret generic chat-crdt-server-secrets -n chat-crdt \
  --from-literal=JWT_SECRET=<CHANGE_ME_32_CHARS_MIN> \
  --from-literal=DATABASE_URL="postgresql://chatcrdt:<SAME_PASSWORD_AS_ABOVE>@postgres:5432/chatcrdt"
```

`JWT_SECRET` / `DATABASE_URL` land in the server container via
`secretKeyRef` (`infra/k8s/base/deployment.yaml`) — never as literal
ConfigMap values.

## `/metrics` — no JWT, but never public

`MetricsController` (`apps/server/src/metrics/metrics.controller.ts`)
intentionally has no `JwtAuthGuard` — Prometheus scrapes it unauthenticated
over the ClusterIP network. **This is only safe because nothing here routes
it through a public Ingress.** There is no Ingress resource in this
manifest set; if one is added later (GKE), it must explicitly exclude
`/metrics`, or the endpoint needs a guard added first.

## Local validation (kind)

```sh
# 1. Build and load the image (see apps/server/Dockerfile for why context = repo root)
docker build -f apps/server/Dockerfile -t chat-crdt-server:local .
kind create cluster --name chat-crdt   # skip if a cluster already exists
kind load docker-image chat-crdt-server:local --name chat-crdt

# 2. Secrets (see above), then apply
kubectl create secret generic postgres-credentials -n chat-crdt ...
kubectl create secret generic chat-crdt-server-secrets -n chat-crdt ...
kubectl apply -k infra/k8s/overlays/local

# 3. Wait for rollout
kubectl -n chat-crdt rollout status deploy/server
kubectl -n chat-crdt get pods -o wide   # expect 2 server pods on-schedule

# 4. Run the Prisma migration against the in-cluster Postgres (dev-grade —
#    no migration Job wired up yet, run it by hand for local validation)
kubectl -n chat-crdt port-forward svc/postgres 5432:5432 &
DATABASE_URL="postgresql://chatcrdt:<PASSWORD>@localhost:5432/chatcrdt" \
  bunx --cwd apps/server prisma migrate deploy

# 5. Prove 2 replicas + Redis fan-out
kubectl -n chat-crdt port-forward svc/server 3001:3001 &
curl -s localhost:3001/metrics | grep -E 'ws_connections|rooms_loaded'
# open two WS clients (or run apps/server/bench against the forwarded port)
# against room "default", send from one, confirm the other receives it —
# that traffic only converges if both pods are actually talking through Redis.

# 6. Dashboard
kubectl -n chat-crdt port-forward svc/grafana 3000:3000 &
# open http://localhost:3000 — anonymous Viewer (see grafana-deployment.yaml),
# dashboard "chat-crdt server" is pre-provisioned.
kubectl -n chat-crdt port-forward svc/prometheus 9090:9090 &
curl -s 'localhost:9090/api/v1/query?query=up{job="chat-crdt-server"}'
# expect 2 results (one per pod) with value 1

# Teardown
kind delete cluster --name chat-crdt
```

## Cardinality caveat

`yjs_state_bytes` is labeled by `roomId` — one series per room currently
loaded in a pod's memory (rooms are evicted ~30s after the last client
leaves, see `ROOM_GC_DELAY_MS` in `sync.gateway.ts`), not per room ever
created. Fine at MVP scale; if room count grows into the thousands this
should become a histogram of state sizes instead of a per-room gauge (see
`apps/server/src/metrics/metrics.service.ts`).
