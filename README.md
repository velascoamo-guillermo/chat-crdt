# chat-crdt

Offline-first real-time chat with CRDT sync. Multi-room: users create,
list, and join rooms; a 'default' room stays open to every authenticated
user with no explicit join.

> **Staff Mobile portfolio project.** Demonstrates offline-first architecture, CRDT merge semantics, cross-platform sync, and extractable npm library design.

## Architecture

```
┌─────────────────────────────────────────────┐
│  Expo Router (React Native)                 │
│  FlashList · Zustand · expo-secure-store    │
│                                             │
│  ┌──────────────────────────────────┐       │
│  │  @chat-crdt/sync-engine          │       │
│  │  SyncEngine (Yjs Y.Array)        │       │
│  │  WebSocketProvider (offline Q)   │       │
│  │  SQLitePersistence (op-sqlite)   │       │
│  └──────────┬───────────────────────┘       │
└─────────────┼───────────────────────────────┘
              │ WebSocket (y-protocols binary)
              ▼
┌─────────────────────────────────────────────┐
│  NestJS Server                              │
│  SyncGateway (Yjs Y.Doc per room)           │
│  AuthModule (JWT)                           │
│  PrismaModule (PostgreSQL)                  │
│                │                            │
│         Redis pub/sub                       │
│         (multi-instance fan-out)            │
└─────────────────────────────────────────────┘
```

## Stack

| Layer | Technology |
|---|---|
| Mobile | Expo SDK 56, React Native 0.85, Expo Router, FlashList |
| Native UI | `@expo/ui` (login + register screens as native islands) |
| CRDT sync | Yjs, y-protocols, `@chat-crdt/sync-engine` |
| Mobile storage | op-sqlite (SQLite) |
| State | Zustand |
| Backend | NestJS v11, WebSocket (ws) |
| Auth | JWT (passport-jwt), WS subprotocol auth |
| Database | PostgreSQL 16 + Prisma 5 |
| Realtime fan-out | Redis 7 pub/sub + presence tracking |

## Quick start

```bash
# 1. Start infrastructure
docker compose -f infra/docker-compose.yml up -d

# 2. Install all dependencies
bun install

# 3. Run DB migrations
cd apps/server && bunx prisma migrate deploy

# 4. Start the server
cd apps/server && bun run dev

# 5. Start the mobile app
cd apps/mobile && bun run dev
```

## Project structure

```
chat-crdt/
  apps/
    mobile/          # Expo Router app
    server/          # NestJS backend
  packages/
    sync-engine/     # Yjs wrapper — extractable npm package
    shared/          # Shared TypeScript types
  infra/
    docker-compose.yml
  docs/
    adr/             # Architecture Decision Records
```

## Key design decisions

See [docs/adr/](docs/adr/) for documented architecture decisions.

**Messages are CRDT-only.** No `Message` rows in the database — chat history lives entirely in Yjs state, persisted as a single `yjsState` blob on the `Room` model. This keeps the DB schema minimal and makes CRDT the single source of truth.

**Room authorization via `RoomMember`.** Every WebSocket connection is authorized against the `RoomMember` join table. Users can only sync rooms they belong to — except the special `'default'` room, an open lobby every authenticated user may enter with no membership row (`SyncGateway.handleConnection` skips the check for it, and `GET /rooms` always includes it in the listing). Joining a non-default room is currently open to any authenticated user (`POST /rooms/:name/join`, MVP semantics — no invite/approval flow yet).

**Multi-room client lifecycle.** The mobile app runs one `SyncEngine` + `WebSocketProvider` + `SQLitePersistence` per open room screen (`apps/mobile/src/hooks/useSync.ts`), created when the room screen mounts and torn down in its effect cleanup when the screen unmounts — no leaked sockets or timers when navigating between rooms. Teardown is strictly sequenced: `SQLitePersistence.destroy()` flushes the last debounced write and resolves only once that write has actually landed in storage (not merely started — see `packages/sync-engine/src/SQLitePersistence.destroyAwaitsFlush.test.ts`), *then* the `SyncEngine`'s Yjs doc is destroyed, *then* the SQLite handle is closed — closing any earlier could race the flush and silently drop the last debounced write. Navigation to a room uses `router.navigate` (not `push`) so revisiting an already-open room dedupes to its existing screen instead of mounting a duplicate; `chat.store`'s per-room mount refcount (`registerMount`/`clearRoom`) is a belt-and-suspenders backstop that only deletes a room's data once every mounted instance for it has torn down. All rooms share one SQLite database; `SQLitePersistence` already keys storage by `yjs:${roomId}`, so per-room state never cross-contaminates (see `packages/sync-engine/src/SQLitePersistence.roomScoping.test.ts`). A WebSocket closed with code `4003` (authenticated but not a room member) surfaces as a "not a member" state in the UI rather than the generic auth-failure logout used for other `4xxx` codes. Room names `rooms`, `account`, and `default` are reserved server-side (`CreateRoomDto`) because they'd shadow the mobile client's static `(chat)/rooms` and `(chat)/account` routes.

## Offline-first flow

1. User sends message → inserted into local `Y.Array` immediately (optimistic)
2. `SQLitePersistence` persists Yjs state to SQLite on every update
3. `WebSocketProvider` sends update to server via y-protocols binary protocol
4. If offline: update queued in memory, flushed with exponential backoff on reconnect
5. On reconnect: client sends state vector, server responds with diff, CRDT merge is automatic

## Running tests

```bash
# sync-engine unit tests
cd packages/sync-engine && bun test

# server unit tests
cd apps/server && npx jest
```

## Server features

- **WS subprotocol auth** — JWT passed as WebSocket subprotocol, validated before room join
- **Rate limiting** — per-connection message rate limiting in `SyncGateway`
- **Presence** — online user tracking across Redis-connected server instances
- **True-delta fan-out** — server computes and broadcasts only the delta, not full state

## ADRs

- [ADR 001: Yjs over Automerge](docs/adr/001-yjs-over-automerge.md)
- [ADR 002: Messages live in the CRDT only](docs/adr/002-crdt-only-messages.md)
- [ADR 003: JWT via WebSocket subprotocol](docs/adr/003-ws-subprotocol-auth.md)
- [ADR 004: Redis true-delta, origin-tagged fan-out](docs/adr/004-redis-delta-fanout.md)
- [ADR 005: Extractable sync-engine — injected storage, yjs peer dep](docs/adr/005-extractable-sync-engine.md)
- [ADR 006: Debounced full-snapshot persistence](docs/adr/006-snapshot-persistence.md)
- [ADR 007: @expo/ui native islands + FlashList split](docs/adr/007-expo-ui-native-islands.md)
- [ADR 008: Zustand projection + awareness for ephemeral state](docs/adr/008-zustand-and-awareness-state.md)
- [ADR 009: yjsState retention — monitor + GC now, epoch compaction on trigger](docs/adr/009-yjsstate-retention.md)

## Audits

- [2026-06-07 — initial full-stack audit](docs/audit-improvements.md) (all items closed except yjsState pruning)
- [2026-06-12 — post-remediation audit](docs/audit-2026-06-12.md)
