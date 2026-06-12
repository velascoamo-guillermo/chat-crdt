# ADR-002: Messages live in the CRDT only — no relational Message table

**Date:** 2026-06-12
**Status:** Accepted (implemented; documents the decision shipped in `refactor(server): drop dead Message model`)

## Context

Chat history must merge conflict-free across offline clients, so messages already live in a Yjs `Y.Array`. The original schema also had a relational `Message` table — but nothing ever wrote to it. That left two candidate sources of truth and a standing temptation to dual-write.

## Decision

The Yjs document is the **single source of truth** for messages. The server persists it as one opaque `Room.yjsState: Bytes` blob; the client persists the same state to SQLite. The `Message` model was dropped from the Prisma schema entirely.

Why: dual-writing CRDT state and relational rows means every ordering, dedup, and edit bug exists twice and the two stores drift the moment a write path forgets one side. A relational mirror earns its keep only when something queries it — nothing did.

## Alternatives Considered

- **Dual-write (CRDT + Message rows):** rejected. Two sources of truth, drift by construction, and the relational side cannot represent CRDT merge results without re-deriving them from the doc anyway.
- **Relational-only with server timestamps:** rejected. Loses offline merge — the entire point of the project. Last-write-wins on the server reintroduces the conflicts CRDTs eliminate.

## Consequences

**Good:** one merge semantics end to end; minimal schema (`User`, `Room`, `RoomMember`); server treats message content as opaque bytes — no content parsing on the hot path.

**Bad:** no SQL over messages. Search, moderation, and analytics need a read-side projection (subscribe to doc updates, project into rows — additive, no dual-write from clients) when those features arrive. History size is bounded by what one Yjs doc can practically hold; the blob grows without pruning (see ADR-006 and the open snapshot/GC item).
