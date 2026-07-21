# chat-crdt

Offline-first real-time chat with CRDT sync. Single-room MVP.

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

**Room authorization via `RoomMember`.** Every WebSocket connection is authorized against the `RoomMember` join table. Users can only sync rooms they belong to.

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
