# WebSocket Heartbeat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect and evict half-open WebSocket connections so dead sockets stop blocking room garbage collection and consuming fan-out.

**Architecture:** Standard `ws` ping/pong liveness sweep on the server. A per-socket `alive` flag (WeakMap) is set true on connect and on every `pong`. An interval running every 30 s pings each client and `terminate()`s any that missed the previous cycle's pong. `terminate()` fires `'close'`, so the existing `handleDisconnect` cleanup (awareness removal, room GC) runs unchanged. Audit 2026-06-12 #2.

**Tech Stack:** `@nestjs/websockets` (`OnGatewayInit`, `OnModuleDestroy`), `ws`, Jest fake timers. **Depends on Plan 2's `FakeSocket` harness** (`apps/server/src/sync/__test__/fakes.ts`) — run that plan first.

**Prerequisite:** `FakeSocket` exists. If Plan 2 is not yet merged, implement `fakes.ts` from Plan 2 Task 1 Step 1 before starting.

---

### Task 1: Liveness sweep — terminate dead sockets, ping live ones

**Files:**
- Modify: `apps/server/src/sync/sync.gateway.ts`
- Modify: `apps/server/src/sync/sync.gateway.spec.ts`

- [ ] **Step 1: Write the failing test for `sweepHeartbeats`**

Add to `apps/server/src/sync/sync.gateway.spec.ts` a new block (uses `FakeSocket` already imported):

```typescript
  describe('sweepHeartbeats', () => {
    function withClients(...clients: FakeSocket[]) {
      (gateway as any).server = { clients: new Set(clients) };
    }

    it('terminates a client that missed the previous pong', () => {
      const dead = new FakeSocket();
      withClients(dead);
      (gateway as any).alive.set(dead, false); // missed last cycle

      gateway.sweepHeartbeats();

      expect(dead.terminate).toHaveBeenCalledTimes(1);
      expect(dead.ping).not.toHaveBeenCalled();
    });

    it('pings a live client and arms it for the next cycle', () => {
      const live = new FakeSocket();
      withClients(live);
      (gateway as any).alive.set(live, true);

      gateway.sweepHeartbeats();

      expect(live.ping).toHaveBeenCalledTimes(1);
      expect(live.terminate).not.toHaveBeenCalled();
      expect((gateway as any).alive.get(live)).toBe(false); // re-armed
    });
  });
```

- [ ] **Step 2: Run — expect FAIL (method + `alive` field do not exist)**

Run: `cd apps/server && bunx jest sync.gateway -t sweepHeartbeats --verbose`
Expected: FAIL — `gateway.sweepHeartbeats is not a function` / `alive` undefined.

- [ ] **Step 3: Implement the fields + sweep method**

In `apps/server/src/sync/sync.gateway.ts`:

Add the constant beside the others (after `RATE_LIMIT_MAX_MSGS`):

```typescript
const HEARTBEAT_INTERVAL_MS = 30_000;
```

Add the fields after `awarenessIds`:

```typescript
  // Liveness flag per socket: true on connect + on every pong. A sweep that
  // finds `false` evicts the socket (it missed the previous ping's pong).
  private readonly alive = new WeakMap<WebSocket, boolean>();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
```

Add the method (place it after `isRateLimited`):

```typescript
  /**
   * Ping every client; terminate any that missed the previous cycle's pong.
   * `terminate()` fires 'close', so handleDisconnect runs the normal cleanup
   * (awareness removal + room GC) — no special-casing here.
   */
  sweepHeartbeats(): void {
    this.server.clients.forEach((client: WebSocket) => {
      if (this.alive.get(client) === false) {
        this.logger.warn('Heartbeat timeout — terminating dead socket');
        client.terminate();
        return;
      }
      this.alive.set(client, false);
      client.ping();
    });
  }
```

- [ ] **Step 4: Run — expect PASS**

Run: `cd apps/server && bunx jest sync.gateway -t sweepHeartbeats --verbose`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/sync/sync.gateway.ts apps/server/src/sync/sync.gateway.spec.ts
git commit -m "feat(sync): heartbeat sweep terminates half-open sockets

Audit 2026-06-12 #2."
```

---

### Task 2: Arm liveness on connect + reset on pong

**Files:**
- Modify: `apps/server/src/sync/sync.gateway.ts` (`handleConnection`)
- Modify: `apps/server/src/sync/sync.gateway.spec.ts`

- [ ] **Step 1: Write the failing test**

Add inside `describe('handleConnection success', ...)`:

```typescript
    it('marks the client alive on connect and resets alive on pong', async () => {
      jwt.verify.mockReturnValue({ sub: 'user-1' });

      const client = new FakeSocket();
      await gateway.handleConnection(client as any, fakeReq({ room: 'default', token: 'ok' }));

      expect((gateway as any).alive.get(client)).toBe(true);

      // Simulate a missed cycle, then a pong arriving.
      (gateway as any).alive.set(client, false);
      client.emit('pong');
      expect((gateway as any).alive.get(client)).toBe(true);
    });
```

- [ ] **Step 2: Run — expect FAIL (`alive` not set on connect)**

Run: `cd apps/server && bunx jest sync.gateway -t "resets alive on pong" --verbose`
Expected: FAIL — `alive.get(client)` is `undefined`, not `true`.

- [ ] **Step 3: Wire it in `handleConnection`**

In `handleConnection`, immediately after:

```typescript
    room.clients.add(client);
    this.clientRoom.set(client, roomId);
```

add:

```typescript
    // Heartbeat liveness: alive on connect, re-armed on every pong.
    this.alive.set(client, true);
    client.on('pong', () => this.alive.set(client, true));
```

- [ ] **Step 4: Run — expect PASS**

Run: `cd apps/server && bunx jest sync.gateway -t "resets alive on pong" --verbose`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/sync/sync.gateway.ts apps/server/src/sync/sync.gateway.spec.ts
git commit -m "feat(sync): arm heartbeat liveness on connect + reset on pong"
```

---

### Task 3: Start the sweep on init, stop it on shutdown

**Files:**
- Modify: `apps/server/src/sync/sync.gateway.ts` (class signature, imports, `afterInit`, `onModuleDestroy`)
- Modify: `apps/server/src/sync/sync.gateway.spec.ts`

- [ ] **Step 1: Write the failing lifecycle test**

Add a new top-level block in the spec:

```typescript
  describe('heartbeat lifecycle', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('runs the sweep on the interval after init and stops after destroy', () => {
      const sweep = jest.spyOn(gateway, 'sweepHeartbeats').mockImplementation(() => {});
      const fakeServer = { clients: new Set() };

      gateway.afterInit(fakeServer as any);
      jest.advanceTimersByTime(30_000);
      expect(sweep).toHaveBeenCalledTimes(1);

      gateway.onModuleDestroy();
      jest.advanceTimersByTime(60_000);
      expect(sweep).toHaveBeenCalledTimes(1); // no further ticks after destroy

      sweep.mockRestore();
    });
  });
```

- [ ] **Step 2: Run — expect FAIL (`afterInit` / `onModuleDestroy` missing)**

Run: `cd apps/server && bunx jest sync.gateway -t "heartbeat lifecycle" --verbose`
Expected: FAIL — `gateway.afterInit is not a function`.

- [ ] **Step 3: Add the lifecycle hooks**

In `apps/server/src/sync/sync.gateway.ts`:

Extend the NestJS imports to add the two interfaces:

```typescript
import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
} from '@nestjs/websockets';
import { Inject, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
```

Extend the class signature:

```typescript
export class SyncGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit, OnModuleInit, OnModuleDestroy
{
```

Add the two methods (place them right after `onModuleInit`):

```typescript
  afterInit(server: Server): void {
    this.server = server;
    this.heartbeatTimer = setInterval(() => this.sweepHeartbeats(), HEARTBEAT_INTERVAL_MS);
    this.heartbeatTimer.unref();
  }

  onModuleDestroy(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
```

- [ ] **Step 4: Run — expect PASS**

Run: `cd apps/server && bunx jest sync.gateway -t "heartbeat lifecycle" --verbose`
Expected: PASS.

- [ ] **Step 5: Run the full server suite + typecheck**

Run: `cd apps/server && bun run test && bunx tsc --noEmit`
Expected: all gateway + auth tests green; no type errors.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/sync/sync.gateway.ts apps/server/src/sync/sync.gateway.spec.ts
git commit -m "feat(sync): start heartbeat sweep on init, clear on shutdown

30s interval; timer unref'd so it never holds the process open. Completes
audit 2026-06-12 #2 — half-open sockets are now evicted and room GC unblocks."
```

---

## Self-Review Notes

- **Spec coverage:** dead-socket termination, live-socket ping + re-arm, connect arms liveness, pong resets, interval starts on init, interval cleared on destroy. Full lifecycle.
- **Free cleanup:** `terminate()` → `'close'` → existing `handleDisconnect` means no duplicate awareness/GC logic. Verified by the existing Task 6 disconnect test in Plan 2.
- **No process-hang risk:** `heartbeatTimer.unref()` keeps the interval from holding the event loop open during shutdown.
- **Type consistency:** `sweepHeartbeats` (public for test access), `alive` WeakMap, `heartbeatTimer` — names identical across all three tasks.
