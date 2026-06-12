# ADR-006: Debounced full-snapshot persistence on both tiers

**Date:** 2026-06-12
**Status:** Accepted

## Context

Yjs emits an update per transaction. Persisting on every update was the original behavior — an O(history) re-encode and write per message, on the JS thread on mobile (🟡 in the 2026-06-07 audit). The two durable options: append each delta to an update log, or write the whole encoded state, less often.

## Decision

Both tiers write the **full encoded state, debounced**: 500 ms on the client (`SQLitePersistence` → one SQLite key), 5 s on the server (`Room.yjsState` column). Pending writes are flushed on destroy/unmount (client) and before room GC (server), so the debounce never drops the tail.

Why snapshot over log at this stage: load becomes one read + one `applyUpdate` — no replay, no compaction job, no log-table schema. The crash-loss window equals the debounce interval, and even that is soft: a client that loses its last 500 ms re-receives those messages from the server on the next sync handshake; the server's 5 s window is covered by clients re-sending via the same handshake. The CRDT makes re-application idempotent, so "lose locally, recover from the other side" is free.

## Alternatives Considered

- **Persist every update:** rejected — the O(history)-per-message behavior this replaces.
- **Append-only update log:** rejected for now — faster individual writes, but requires compaction (unbounded log growth), replay on load, and migration tooling. Justified at collaborative-text update rates; not at chat-message rates.

## Consequences

**Good:** trivial load path; bounded, coalesced write rate; lifecycle flushes make the debounce safe; storage stays a single key/column.

**Bad:** each flush is O(history) — cost grows with room lifetime, which makes this ADR the main feeder of the open **snapshot/GC** item: without periodic tombstone compaction the blob and the flush cost grow forever. Revisit (and likely write ADR-009) when a room's `yjsState` approaches ~1 MB.
