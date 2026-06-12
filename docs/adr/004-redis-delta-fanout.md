# ADR-004: Redis pub/sub with true-delta, origin-tagged fan-out

**Date:** 2026-06-12
**Status:** Accepted (implemented in `fix(sync): repair WS auth, true-delta fan-out + hardening`)

## Context

Horizontal scaling needs cross-instance propagation: clients of room X may be connected to different server nodes. The first implementation published `Y.encodeStateAsUpdate(room.doc)` — the **entire document** — to Redis on every message: O(n) bandwidth per message, quadratic over a room's life (🔴 in the 2026-06-07 audit). It also needed a mechanism to avoid echo loops between instances.

## Decision

All propagation hangs off the Yjs doc's `update` event, which fires with the **true incremental delta**. The transaction origin disambiguates the source:

- origin = a client socket → fan out to local clients (except the sender), publish `{instanceId, delta}` to `room:update:<roomId>`, schedule persist;
- origin = `'redis'` → fan out locally only — never re-publish.

Subscribers skip payloads whose `instanceId` is their own. The awareness (presence/typing) channel mirrors the exact same pattern. One handler is the single source of truth for fan-out, Redis, and persistence — there is no second code path to drift.

Why pub/sub and not a durable log: durability already lives in Postgres (`yjsState`), and the sync protocol's state-vector handshake on reconnect is the correctness mechanism. The bus only needs to be fast, not lossless.

## Alternatives Considered

- **Full-state publish:** rejected — the quadratic behavior this replaces.
- **Sticky sessions / single instance:** rejected — defeats horizontal scaling and gives up zero-downtime deploys.
- **Redis Streams / Kafka:** rejected for now — at-least-once delivery and consumer groups buy durability we get from Postgres + the sync handshake. Operational cost without a current failure mode to solve.

## Consequences

**Good:** O(delta) bandwidth and CPU regardless of history size; echo-loop-free by construction (origin tags in both directions); presence consistent across nodes through the same mechanism.

**Bad:** pub/sub is at-most-once — a dropped message leaves two instances' docs diverged until the next client sync handshake or room reload re-converges them. Acceptable for chat; Streams is the upgrade path if divergence windows ever matter. Every instance holding a room also persists it (redundant writes — benign because docs converge, but see audit 2026-06-12 #8).
