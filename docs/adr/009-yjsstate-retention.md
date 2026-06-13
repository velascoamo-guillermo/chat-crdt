# ADR-009: yjsState retention — monitor + explicit GC now, epoch compaction on trigger

**Date:** 2026-06-12
**Status:** Accepted

## Context

A room's entire message history lives in one `Y.Doc`, persisted as a single
`Room.yjsState` blob and mirrored to client SQLite. History only grows, and
ADR-006 re-encodes the full state on every debounced persist — so persist cost
is O(history) and rises for the room's whole life. Audit 2026-06-07 deferred
this; audit 2026-06-12 (#3) re-raises it as the one structural scale ceiling.

Two tempting "fixes" are wrong here:
- **Drop Yjs tombstones.** The message list is append-only, so there are almost
  no tombstones to drop. Near-zero benefit.
- **Trim the live doc to the last N messages.** Building a fresh doc with the
  retained slice gives every message new clientIDs. An offline client that
  reconnects merges the fresh snapshot into its old doc — the messages no longer
  share identity, so they **duplicate** instead of merging. This is the trap.

## Decision

Three-part decision:

1. **Monitor now.** Emit a warning (and a future metric) when a room's persisted
   `yjsState` crosses 1 MB. This is the trigger signal for Part 3; we do not act
   blind.
2. **Make GC explicit now.** Construct every `Y.Doc` with `{ gc: true }`
   (server `RoomState`, client `SyncEngine`). It is the default, but pinning it
   means a future `gcFilter` change can't silently disable struct GC.
3. **Defer epoch compaction until the trigger fires.** When a live room actually
   needs bounded history, compact via a **room epoch**: the server builds a
   trimmed snapshot under a new epoch number; clients store their epoch and, on
   seeing a higher server epoch, flush any unsynced local messages, then **adopt
   the server snapshot wholesale** (discarding the old local doc) instead of
   merging. This is the only trim that avoids the duplication trap. It is a real
   protocol change with a client migration — not worth building before a room
   demonstrably needs it.

## Alternatives Considered

- **Cold-archive every message to Postgres rows, keep the live doc unbounded:**
  rejected as the primary fix — does not bound live persist cost (the actual
  pain). Still useful later as the read-model for search/moderation (see ADR-002),
  but orthogonal.
- **Append-only update log instead of full-state snapshots (revisit ADR-006):**
  rejected — bounds per-write cost but not total size, and adds compaction +
  replay machinery. Same YAGNI verdict until the metric trips.
- **Build epoch compaction now:** rejected — speculative; the protocol + client
  migration is real cost against a ceiling no current room approaches.

## Consequences

**Good:** the real ceiling is now observable, not theoretical; GC intent is
pinned; the correct compaction design is written down so the eventual build
starts from a decision, not a blank page.

**Bad:** unbounded growth is accepted for now — a single pathological room can
still bloat its blob until the 1 MB warning prompts action. The epoch-compaction
client migration is deferred debt, explicitly owned here.
