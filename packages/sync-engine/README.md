# @chat-crdt/sync-engine

CRDT (Yjs) sync engine for chat-crdt: an offline-first message store (`SyncEngine`), a
reconnecting WebSocket provider (`WebSocketProvider`), and a pluggable key-value
persistence adapter (`SQLitePersistence`).

Ships as dual CJS/ESM with bundled types (`dist/index.js` + `dist/esm/index.js`).

## Install

```sh
npm install @chat-crdt/sync-engine yjs
```

### Peer dependencies

| Package | Required | Notes |
| --- | --- | --- |
| `yjs` | Yes (`^13.6.0`) | The CRDT document engine `SyncEngine` wraps. |

`SQLitePersistence` does **not** depend on `@op-engineering/op-sqlite` or any other native
module — it's storage-agnostic behind a small `IStorage` interface
(`getItem`/`setItem`). Bring your own backing store (SQLite, AsyncStorage,
`localStorage`, an in-memory `Map`, ...). An in-memory `MemoryStorage` implementation
ships for tests and SSR. This makes the package safe to import from plain Node
(servers, scripts) without pulling in any platform-specific native dependency.

## Usage

```ts
import { SyncEngine, WebSocketProvider, SQLitePersistence, MemoryStorage } from '@chat-crdt/sync-engine';

// 1. Create the CRDT engine for a room.
const engine = new SyncEngine({ roomId: 'general', userId: 'u1', username: 'guille' });

// 2. Optionally persist the doc locally. Swap MemoryStorage for a real
//    IStorage-compatible adapter (e.g. an expo-sqlite or op-sqlite wrapper) in apps.
const persistence = new SQLitePersistence(engine, new MemoryStorage());
await persistence.load();

// 3. Connect to the sync server. Local updates are queued until connected.
const provider = new WebSocketProvider(engine, {
  url: 'wss://example.com/sync',
  token: 'jwt-token',
  username: 'guille',
  onStatusChange: (status) => console.log('ws status:', status),
});

engine.subscribe((messages) => console.log('messages:', messages));
engine.sendMessage('hello world');

// Teardown
provider.destroy();
persistence.destroy();
engine.destroy();
```

## Exports

Everything is exported from the package root (`.`) — there are no subpath exports.
This is intentional: it keeps the package resolvable under `node10`/`node16`/bundler
resolution alike, and new named exports (e.g. an injectable `ContentCipher`, planned
per ADR-010) can be added without becoming a breaking change.

- `SyncEngine`, `SyncEngineConfig`
- `WebSocketProvider`, `WebSocketProviderConfig`, `ProviderStatus`
- `SQLitePersistence`, `MemoryStorage`, `IStorage`

## Development

```sh
bun run build      # tsc (CJS) + tsc -p tsconfig.esm.json (ESM) + ESM marker/type files
bun run test        # bun test
bun run typecheck    # tsc --noEmit
```
