# ADR 001: Yjs over Automerge for CRDT message list

**Status:** Accepted  
**Date:** 2026-05-03

## Context

The message list requires CRDT semantics: two clients sending messages offline must merge without conflicts or duplicates when they reconnect. The two main candidates were Yjs and Automerge.

## Decision

Use **Yjs** with `Y.Array` as the message list CRDT.

## Reasons

- **Battle-tested:** Used in production by TipTap, Liveblocks, Hocuspocus, and others.
- **Sync protocol included:** `y-protocols` provides the WebSocket sync handshake (state vector exchange, incremental updates) out of the box — no custom protocol design needed.
- **Awareness protocol:** Built-in presence layer for typing indicators and online state, reusing the same transport.
- **Bundle size:** ~60 KB gzipped vs ~400 KB for Automerge.
- **React Native support:** No WASM dependency (Automerge 2.x requires WASM which is unsupported in Hermes/RN).

## Trade-offs

- Automerge has richer semantics (full operation history, time-travel, undo/redo out of the box).
- Yjs has edge cases with very large document history — mitigated by periodic snapshots (future work).
- If per-message edit history (collaborative text editing) is needed in future, Automerge would be reconsidered.

## Consequences

- Server maintains a `Y.Doc` per room in memory, backed by `Room.yjsState: Bytes` in PostgreSQL.
- Mobile client persists Yjs state to SQLite via `SQLitePersistence` from `@chat-crdt/sync-engine`.
- The `@chat-crdt/sync-engine` package wraps Yjs and is extractable as a standalone npm package.
