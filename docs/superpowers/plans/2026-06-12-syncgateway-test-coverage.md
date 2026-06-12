# SyncGateway Test Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cover `SyncGateway` — the repo's most complex, most security-sensitive file — with unit tests for auth handshake, membership gate, delta fan-out, Redis echo suppression, and disconnect cleanup.

**Architecture:** These are **characterization tests** over existing, already-shipped behavior, not TDD-first tests. Each test is written to PASS against the current implementation; a failure means a real defect to file, not a red-to-green step. A reusable fakes harness (`FakeSocket` EventEmitter + fake `IncomingMessage` + ioredis mock) lets us drive `handleConnection` / `handleMessage` / `handleDisconnect` and the private doc/awareness update handlers without opening real sockets. Plan 3 (WebSocket heartbeat) reuses `FakeSocket`.

**Tech Stack:** Jest 29 + ts-jest, `@nestjs/testing`, `yjs`, `y-protocols`, Node `EventEmitter`.

**Why this is hard / load-bearing:** `SyncGateway` owns the auth boundary (close codes 4001/4003), the only place message deltas fan out, and the Redis origin-tagging that prevents echo loops. Audit 2026-06-12 #4 flags it as exercised only manually.

---

### Task 1: Test harness + first auth test (bad token → 4001)

**Files:**
- Create: `apps/server/src/sync/__test__/fakes.ts`
- Create: `apps/server/src/sync/sync.gateway.spec.ts`

- [ ] **Step 1: Write the fakes harness**

Create `apps/server/src/sync/__test__/fakes.ts`:

```typescript
import { EventEmitter } from 'events';
import type { IncomingMessage } from 'http';

const OPEN = 1;
const CLOSED = 3;

/** Stand-in for a `ws` WebSocket: real EventEmitter (so on/once/emit work),
 *  jest-spied send/close/terminate/ping, and inspectable sent/close records. */
export class FakeSocket extends EventEmitter {
  readyState = OPEN;
  sent: Uint8Array[] = [];
  closeCalls: Array<{ code?: number; reason?: string }> = [];
  terminated = false;

  send = jest.fn((data: Uint8Array) => {
    this.sent.push(data);
  });
  close = jest.fn((code?: number, reason?: string) => {
    this.closeCalls.push({ code, reason });
    this.readyState = CLOSED;
  });
  terminate = jest.fn(() => {
    this.terminated = true;
    this.readyState = CLOSED;
    this.emit('close');
  });
  ping = jest.fn();

  lastCloseCode(): number | undefined {
    return this.closeCalls.at(-1)?.code;
  }
}

/** Minimal IncomingMessage: url carries the room, header carries the token. */
export function fakeReq(opts: { room?: string; token?: string } = {}): IncomingMessage {
  const room = opts.room ?? 'default';
  const protocol = opts.token ? `bearer, ${opts.token}` : '';
  return {
    url: `/sync?room=${room}`,
    headers: { 'sec-websocket-protocol': protocol },
  } as unknown as IncomingMessage;
}

export function redisMock() {
  return {
    publish: jest.fn(),
    psubscribe: jest.fn(),
    on: jest.fn(),
  };
}
```

- [ ] **Step 2: Write the spec harness + first test**

Create `apps/server/src/sync/sync.gateway.spec.ts`:

```typescript
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { SyncGateway } from './sync.gateway';
import { PrismaService } from '../prisma/prisma.service';
import { RoomsService } from '../rooms/rooms.service';
import { FakeSocket, fakeReq, redisMock } from './__test__/fakes';

describe('SyncGateway', () => {
  let gateway: SyncGateway;
  let jwt: { verify: jest.Mock };
  let rooms: { isMember: jest.Mock };
  let prisma: { room: { findUnique: jest.Mock; upsert: jest.Mock; update: jest.Mock } };
  let pub: ReturnType<typeof redisMock>;
  let sub: ReturnType<typeof redisMock>;

  beforeEach(async () => {
    jwt = { verify: jest.fn() };
    rooms = { isMember: jest.fn() };
    prisma = {
      room: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    pub = redisMock();
    sub = redisMock();

    const module = await Test.createTestingModule({
      providers: [
        SyncGateway,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: jwt },
        { provide: RoomsService, useValue: rooms },
        { provide: 'REDIS_PUB', useValue: pub },
        { provide: 'REDIS_SUB', useValue: sub },
      ],
    }).compile();

    gateway = module.get(SyncGateway);
  });

  describe('handleConnection auth', () => {
    it('closes with 4001 when the token fails verification', async () => {
      jwt.verify.mockImplementation(() => {
        throw new Error('bad token');
      });

      const client = new FakeSocket();
      await gateway.handleConnection(client as any, fakeReq({ token: 'garbage' }));

      expect(client.lastCloseCode()).toBe(4001);
      expect(client.send).not.toHaveBeenCalled();
    });
  });
});
```

- [ ] **Step 3: Run the test — expect PASS (characterization)**

Run: `cd apps/server && bunx jest sync.gateway --verbose`
Expected: PASS. (Failure here means the 4001 auth path regressed — file a bug, do not "fix" the test.)

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/sync/__test__/fakes.ts apps/server/src/sync/sync.gateway.spec.ts
git commit -m "test(server): SyncGateway harness + reject bad token (4001)"
```

---

### Task 2: Membership gate (non-member → 4003)

**Files:**
- Modify: `apps/server/src/sync/sync.gateway.spec.ts` (add to `handleConnection auth`)

- [ ] **Step 1: Add the non-member test**

Inside `describe('handleConnection auth', ...)`, after the 4001 test:

```typescript
    it('closes with 4003 when a valid user is not a member of a non-default room', async () => {
      jwt.verify.mockReturnValue({ sub: 'user-1' });
      rooms.isMember.mockResolvedValue(false);

      const client = new FakeSocket();
      await gateway.handleConnection(client as any, fakeReq({ room: 'private-room', token: 'ok' }));

      expect(rooms.isMember).toHaveBeenCalledWith('private-room', 'user-1');
      expect(client.lastCloseCode()).toBe(4003);
      expect(client.send).not.toHaveBeenCalled();
    });

    it('skips the membership check for the open "default" lobby', async () => {
      jwt.verify.mockReturnValue({ sub: 'user-1' });

      const client = new FakeSocket();
      await gateway.handleConnection(client as any, fakeReq({ room: 'default', token: 'ok' }));

      expect(rooms.isMember).not.toHaveBeenCalled();
      expect(client.send).toHaveBeenCalled(); // sync step1/step2 sent
    });
```

- [ ] **Step 2: Run — expect PASS**

Run: `cd apps/server && bunx jest sync.gateway --verbose`
Expected: PASS (3 tests green).

- [ ] **Step 3: Commit**

```bash
git add apps/server/src/sync/sync.gateway.spec.ts
git commit -m "test(server): SyncGateway membership gate (4003 + default lobby)"
```

---

### Task 3: Successful connection sends sync state + registers client

**Files:**
- Modify: `apps/server/src/sync/sync.gateway.spec.ts` (new describe block)

- [ ] **Step 1: Add the happy-path test**

After the `handleConnection auth` block:

```typescript
  describe('handleConnection success', () => {
    it('sends sync step1 + step2 and tracks the client in the room', async () => {
      jwt.verify.mockReturnValue({ sub: 'user-1' });

      const client = new FakeSocket();
      await gateway.handleConnection(client as any, fakeReq({ room: 'default', token: 'ok' }));

      // step1 (state vector) + step2 (full snapshot) are two distinct sends
      expect(client.send.mock.calls.length).toBeGreaterThanOrEqual(2);

      const rooms = (gateway as any).rooms as Map<string, { clients: Set<unknown> }>;
      expect(rooms.get('default')!.clients.has(client)).toBe(true);

      const clientRoom = (gateway as any).clientRoom as WeakMap<object, string>;
      expect(clientRoom.get(client)).toBe('default');
    });

    it('upserts the room row on first load when no persisted state exists', async () => {
      jwt.verify.mockReturnValue({ sub: 'user-1' });

      const client = new FakeSocket();
      await gateway.handleConnection(client as any, fakeReq({ room: 'default', token: 'ok' }));

      expect(prisma.room.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ where: { name: 'default' } }),
      );
    });
  });
```

- [ ] **Step 2: Run — expect PASS**

Run: `cd apps/server && bunx jest sync.gateway --verbose`
Expected: PASS (5 tests green).

- [ ] **Step 3: Commit**

```bash
git add apps/server/src/sync/sync.gateway.spec.ts
git commit -m "test(server): SyncGateway successful connection registers client + upserts room"
```

---

### Task 4: Delta fan-out excludes the originating client

**Files:**
- Modify: `apps/server/src/sync/sync.gateway.spec.ts` (new describe block)

This drives the private `registerRoomUpdateHandler` through a real `Y.Doc` update. We seed a room, register the handler, add two fake clients, then mutate the doc with one client as the transaction origin.

- [ ] **Step 1: Add the fan-out test**

Add the import at the top of the spec file:

```typescript
import * as Y from 'yjs';
import { RoomState } from './room-state';
```

Then add the block:

```typescript
  describe('doc update fan-out', () => {
    function seedRoom(roomId: string): RoomState {
      const room = new RoomState(roomId);
      (gateway as any).rooms.set(roomId, room);
      (gateway as any).registerRoomUpdateHandler(room);
      return room;
    }

    it('fans a delta out to every local client except the origin, and publishes to Redis', () => {
      const room = seedRoom('default');
      const origin = new FakeSocket();
      const other = new FakeSocket();
      room.clients.add(origin);
      room.clients.add(other);

      // Mutate the doc with `origin` as the transaction origin.
      room.doc.transact(() => {
        room.doc.getArray('messages').push([{ id: 'm1', content: 'hi' }]);
      }, origin);

      expect(other.send).toHaveBeenCalledTimes(1); // received the delta
      expect(origin.send).not.toHaveBeenCalled();   // not echoed to sender
      expect(pub.publish).toHaveBeenCalledWith(
        'room:update:default',
        expect.any(String),
      );
    });
  });
```

- [ ] **Step 2: Run — expect PASS**

Run: `cd apps/server && bunx jest sync.gateway --verbose`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/server/src/sync/sync.gateway.spec.ts
git commit -m "test(server): SyncGateway delta fan-out excludes origin + publishes"
```

---

### Task 5: Redis-origin updates fan out locally but are not re-published

**Files:**
- Modify: `apps/server/src/sync/sync.gateway.spec.ts` (extend `doc update fan-out`)

This guards the echo-loop suppression: an update applied with origin `'redis'` must reach local clients but must NOT be published back to Redis.

- [ ] **Step 1: Add the echo-suppression test**

Inside `describe('doc update fan-out', ...)`:

```typescript
    it('does not re-publish updates that arrived from Redis', () => {
      const room = seedRoom('default');
      const local = new FakeSocket();
      room.clients.add(local);
      pub.publish.mockClear();

      // Build a delta from a separate source doc, then apply it as if from Redis.
      const source = new Y.Doc();
      source.getArray('messages').push([{ id: 'm2', content: 'from other instance' }]);
      const delta = Y.encodeStateAsUpdate(source);

      Y.applyUpdate(room.doc, delta, 'redis');

      expect(local.send).toHaveBeenCalledTimes(1); // fanned out locally
      expect(pub.publish).not.toHaveBeenCalled();  // not echoed back to Redis
    });
```

- [ ] **Step 2: Run — expect PASS**

Run: `cd apps/server && bunx jest sync.gateway --verbose`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/server/src/sync/sync.gateway.spec.ts
git commit -m "test(server): SyncGateway suppresses Redis echo (origin redis not re-published)"
```

---

### Task 6: Disconnect removes the client and clears its awareness states

**Files:**
- Modify: `apps/server/src/sync/sync.gateway.spec.ts` (new describe block)

`handleDisconnect` reads the socket's tracked awareness clientIDs and calls `awarenessProtocol.removeAwarenessStates`. We seed those internals (bypassing the `instanceof WebSocket` gate in the awareness handler, which a fake can't satisfy) and assert the cleanup.

- [ ] **Step 1: Add the import + disconnect block**

Add the import at the top:

```typescript
import * as awarenessProtocol from 'y-protocols/awareness';
```

Then:

```typescript
  describe('handleDisconnect', () => {
    it('removes the client from the room and clears its awareness states', () => {
      const room = new RoomState('default');
      (gateway as any).rooms.set('default', room);

      const client = new FakeSocket();
      room.clients.add(client);
      (gateway as any).clientRoom.set(client, 'default');
      (gateway as any).awarenessIds.set(client, new Set([42]));

      const removeSpy = jest
        .spyOn(awarenessProtocol, 'removeAwarenessStates')
        .mockImplementation(() => {});

      gateway.handleDisconnect(client as any);

      expect(room.clients.has(client)).toBe(false);
      expect(removeSpy).toHaveBeenCalledWith(room.awareness, [42], 'disconnect');
      expect((gateway as any).awarenessIds.has(client)).toBe(false);

      removeSpy.mockRestore();
    });

    it('is a no-op for a socket that never joined a room', () => {
      const client = new FakeSocket();
      expect(() => gateway.handleDisconnect(client as any)).not.toThrow();
    });
  });
```

- [ ] **Step 2: Run the full gateway suite — expect PASS**

Run: `cd apps/server && bunx jest sync.gateway --verbose`
Expected: PASS (all blocks green).

- [ ] **Step 3: Run the whole server suite to confirm no cross-test leakage**

Run: `cd apps/server && bun run test`
Expected: `auth.service.spec.ts` + `sync.gateway.spec.ts` all green.

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/sync/sync.gateway.spec.ts
git commit -m "test(server): SyncGateway disconnect clears client + awareness states"
```

---

## Self-Review Notes

- **Spec coverage:** auth reject (4001), membership reject (4003), default-lobby skip, happy-path send + tracking, room upsert, delta fan-out exclude-origin + publish, Redis echo suppression, disconnect cleanup. Covers every branch flagged in audit #4.
- **Known gap (intentional):** the `instanceof WebSocket` gate in `registerRoomAwarenessHandler` cannot be exercised by `FakeSocket`. Task 6 tests `handleDisconnect`'s cleanup directly by seeding `awarenessIds`. End-to-end awareness propagation belongs in an integration test with real `ws` sockets — out of scope here, noted for a future e2e plan.
- **Lifecycle hooks:** `.compile()` (not `.init()`) is used, so `onModuleInit` (Redis psubscribe) never fires — `sub` mock stays inert by design.
