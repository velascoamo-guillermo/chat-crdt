# yjsState Growth — Retention Decision + Groundwork Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Decide the retention strategy for the ever-growing `yjsState` blob (ADR-009), then ship the non-speculative groundwork — size observability and explicit GC — while gating the expensive epoch-compaction work behind a product-driven trigger.

**Architecture:** The honest framing first. The room's history lives in one `Y.Doc` and grows forever; both tiers re-encode the **full** state per persist (ADR-006), so write cost is O(history). For an **append-only** message list there are almost no tombstones — so naive "drop tombstones" buys little. The real lever is **retention** (how many messages a live room keeps), and trimming a CRDT naively duplicates messages on the next offline-client merge (new doc = new clientIDs = no merge, just re-insert). That hazard is why the 2026-06-07 audit deferred this. This plan makes the safe decision now (monitor + explicit GC), specs the correct compaction protocol (epoch-gated), and refuses to build it speculatively (YAGNI). Audit 2026-06-12 #3.

**Tech Stack:** `yjs`, NestJS `Logger`, Jest. Builds on Plan 2's gateway spec.

---

### Task 1: Write ADR-009 — yjsState retention strategy

**Files:**
- Create: `docs/adr/009-yjsstate-retention.md`
- Modify: `README.md` (ADR index)

- [ ] **Step 1: Write the ADR**

Create `docs/adr/009-yjsstate-retention.md`:

```markdown
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
```

- [ ] **Step 2: Add ADR-009 to the README index**

In `README.md`, under `## ADRs`, after the ADR-008 line, add:

```markdown
- [ADR 009: yjsState retention — monitor + GC now, epoch compaction on trigger](docs/adr/009-yjsstate-retention.md)
```

- [ ] **Step 3: Commit**

```bash
git add docs/adr/009-yjsstate-retention.md README.md
git commit -m "docs(adr): ADR-009 yjsState retention strategy

Monitor + explicit GC now; epoch-gated compaction deferred behind a 1MB
trigger. Audit 2026-06-12 #3."
```

---

### Task 2: yjsState size observability — warn past the retention threshold

**Files:**
- Modify: `apps/server/src/sync/sync.gateway.ts`
- Modify: `apps/server/src/sync/sync.gateway.spec.ts`

- [ ] **Step 1: Write the failing test**

Add a new block to `apps/server/src/sync/sync.gateway.spec.ts`:

```typescript
  describe('yjsState size monitoring', () => {
    it('warns when the persisted blob crosses the retention threshold', () => {
      const warn = jest.spyOn((gateway as any).logger, 'warn');
      (gateway as any).warnIfStateLarge('default', 2_000_000);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('default'));
    });

    it('stays silent below the threshold', () => {
      const warn = jest.spyOn((gateway as any).logger, 'warn');
      warn.mockClear();
      (gateway as any).warnIfStateLarge('default', 1_000);
      expect(warn).not.toHaveBeenCalled();
    });
  });
```

- [ ] **Step 2: Run — expect FAIL (`warnIfStateLarge` missing)**

Run: `cd apps/server && bunx jest sync.gateway -t "yjsState size monitoring" --verbose`
Expected: FAIL — `warnIfStateLarge is not a function`.

- [ ] **Step 3: Implement the threshold check + wire it into persist**

In `apps/server/src/sync/sync.gateway.ts`, add the constant beside the others:

```typescript
const YJS_STATE_WARN_BYTES = 1_000_000; // 1 MB — ADR-009 compaction trigger
```

Add the method (after `persistRoomState`):

```typescript
  /** Trip the ADR-009 retention trigger: warn once per persist past the cap. */
  private warnIfStateLarge(roomId: string, bytes: number): void {
    if (bytes >= YJS_STATE_WARN_BYTES) {
      this.logger.warn(
        `Room "${roomId}" yjsState is ${bytes}B (>= ${YJS_STATE_WARN_BYTES}) — ` +
          `consider ADR-009 epoch compaction`,
      );
    }
  }
```

Wire it into `persistRoomState` — change the method body to measure before write:

```typescript
  private async persistRoomState(room: RoomState): Promise<void> {
    const state = Y.encodeStateAsUpdate(room.doc);
    this.warnIfStateLarge(room.roomId, state.byteLength);
    await this.prisma.room.update({
      where: { name: room.roomId },
      data: { yjsState: Buffer.from(state) },
    });
  }
```

- [ ] **Step 4: Run — expect PASS**

Run: `cd apps/server && bunx jest sync.gateway -t "yjsState size monitoring" --verbose`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/sync/sync.gateway.ts apps/server/src/sync/sync.gateway.spec.ts
git commit -m "feat(sync): warn when yjsState crosses 1MB retention trigger

Implements ADR-009 Part 1 (monitor). Audit 2026-06-12 #3."
```

---

### Task 3: Pin GC explicitly on both server and client docs

**Files:**
- Modify: `apps/server/src/sync/room-state.ts`
- Modify: `packages/sync-engine/src/SyncEngine.ts`
- Modify: `apps/server/src/sync/sync.gateway.spec.ts`
- Modify: `packages/sync-engine/src/SyncEngine.test.ts`

- [ ] **Step 1: Write the failing server-side test**

Add to `apps/server/src/sync/sync.gateway.spec.ts`:

```typescript
  describe('RoomState GC', () => {
    it('constructs the room doc with garbage collection enabled', () => {
      const room = new RoomState('default');
      expect(room.doc.gc).toBe(true);
    });
  });
```

- [ ] **Step 2: Write the failing client-side test**

Add to `packages/sync-engine/src/SyncEngine.test.ts` (match its existing `bun:test` style — check the file's imports and mirror them):

```typescript
test('SyncEngine doc has garbage collection enabled', () => {
  const engine = new SyncEngine({ roomId: 'r', userId: 'u', username: 'alice' });
  expect(engine.doc.gc).toBe(true);
  engine.destroy();
});
```

- [ ] **Step 3: Run both — expect PASS already, or FAIL if a config disabled GC**

Run:
```bash
cd apps/server && bunx jest sync.gateway -t "RoomState GC" --verbose && cd ../..
cd packages/sync-engine && bun test SyncEngine
```
Expected: PASS (Yjs defaults `gc` to true). These tests are the **regression lock**; Steps 4–5 make the intent explicit so the lock has something deliberate to guard.

- [ ] **Step 4: Make GC explicit on the server doc**

In `apps/server/src/sync/room-state.ts`, change the doc construction:

```typescript
  constructor(public readonly roomId: string) {
    this.doc = new Y.Doc({ gc: true });
    this.awareness = new awarenessProtocol.Awareness(this.doc);
  }
```

- [ ] **Step 5: Make GC explicit on the client doc**

In `packages/sync-engine/src/SyncEngine.ts`, change the constructor:

```typescript
  constructor(config: SyncEngineConfig) {
    this.config = config;
    this.doc = new Y.Doc({ gc: true });
    this.messages = this.doc.getArray<MessageDto>('messages');
  }
```

- [ ] **Step 6: Re-run both suites — expect PASS**

Run:
```bash
cd apps/server && bun run test && cd ../..
cd packages/sync-engine && bun test
```
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/sync/room-state.ts packages/sync-engine/src/SyncEngine.ts apps/server/src/sync/sync.gateway.spec.ts packages/sync-engine/src/SyncEngine.test.ts
git commit -m "refactor(sync): pin Y.Doc gc:true on server + client docs

Implements ADR-009 Part 2 (explicit GC). Regression-locked so a future
gcFilter change can't silently disable struct GC."
```

---

## Phase 2 — Epoch Compaction (DESIGN ONLY, do not build yet)

> **Gate:** build only after the Task 2 warning fires for a real room, or product
> sets a history-retention requirement. Until then this is YAGNI. Captured here so
> the eventual build starts from a decision (ADR-009), not a blank page.

**Sketch (for the future plan, not this one):**

1. Add `Room.epoch Int @default(0)` and `RoomMember`/client-stored `epoch`.
2. Server compaction job (on idle, gated by the size trigger): under a Redis
   `SET NX` room lock, build a fresh `Y.Doc` from the last N messages, write it as
   `yjsState`, bump `Room.epoch`.
3. Connection handshake carries the client's epoch. If `server.epoch > client.epoch`:
   the client first flushes unsynced local messages to the server, then **replaces**
   its local doc + SQLite blob with the server snapshot (adopt-wholesale, never
   merge) and records the new epoch.
4. Tests: compaction preserves the last N messages; an offline client with
   pre-cutoff messages does not duplicate them after adopting a higher epoch;
   unsynced local messages survive the flush-then-adopt.

**Why not now:** real protocol change + client migration against a ceiling no
room currently approaches. The monitor (Task 2) tells us when "now" arrives.

---

## Self-Review Notes

- **Spec coverage:** ADR-009 decision (Task 1), monitor (Task 2), explicit GC + regression lock (Task 3), compaction design captured but explicitly un-built (Phase 2).
- **No speculative code:** epoch compaction is design text, not fake-TDD steps — honoring YAGNI per the skill.
- **Type consistency:** `warnIfStateLarge(roomId, bytes)` and `YJS_STATE_WARN_BYTES` used identically in method, call site, and tests; `doc.gc` assertion matches `new Y.Doc({ gc: true })` on both tiers.
