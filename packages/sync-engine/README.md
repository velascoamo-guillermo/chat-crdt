# @chat-crdt/sync-engine

CRDT (Yjs) sync engine for chat-crdt: an offline-first message store (`SyncEngine`), a
reconnecting WebSocket provider (`WebSocketProvider`), and a pluggable key-value
persistence adapter (`SQLitePersistence`).

Ships as dual CJS/ESM with bundled types (`dist/index.js` + `dist/esm/index.js`).

## Install

```sh
npm install @chat-crdt/sync-engine yjs
```

`@chat-crdt/shared` (DTOs like `MessageDto`) is a regular `dependency`, not a
peer — npm installs it transitively, nothing to add by hand for it.

### Peer dependencies

| Package | Required | Notes |
| --- | --- | --- |
| `yjs` | Yes (`^13.6.0`) | The CRDT document engine `SyncEngine` wraps. Not bundled — install it alongside. |

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

## Publishing

`@chat-crdt/sync-engine` depends on `@chat-crdt/shared` via a real semver
range (`^0.1.0`), not the `workspace:*` protocol — that range must resolve
against a version of `@chat-crdt/shared` that's actually on the registry, so
**publish order matters**:

1. `cd packages/shared && npm publish`
2. `cd packages/sync-engine && npm publish`

Publishing sync-engine first would leave its `@chat-crdt/shared` dependency
dangling (`npm install` of the package would 404). Locally, `bun install`
still workspace-links `@chat-crdt/shared` by symlink regardless of the semver
range (verified — no registry round-trip needed for day-to-day dev in this
monorepo); the real range only matters to consumers outside the workspace.

## Development

```sh
bun run build      # tsc (CJS) + tsc -p tsconfig.esm.json (ESM) + ESM marker/type files
bun run test        # bun test + scripts/smoke-test.mjs (packs, installs, requires/imports for real — see below)
bun run typecheck    # tsc --noEmit
```

### Smoke test

`bun run test` also runs `scripts/smoke-test.mjs`, which is the only check in
this package that actually executes the published artifact: it rebuilds both
`@chat-crdt/shared` and `@chat-crdt/sync-engine`, `npm pack`s both, installs
the two tarballs (plus the `yjs` peer dep) into an isolated temp directory
with no workspace/monorepo context, then `require()`s and `import()`s
`@chat-crdt/sync-engine` under real Node and asserts the expected exports are
present. `publint`/`attw`/`npm pack --dry-run` only inspect metadata — none of
them run the code, so none of them would have caught a broken ESM build or a
`workspace:*` specifier leaking into a published `package.json`.
