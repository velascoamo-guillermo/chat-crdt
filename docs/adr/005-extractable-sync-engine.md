# ADR-005: sync-engine as extractable package — injected storage, `yjs` as peer dependency

**Date:** 2026-06-12
**Status:** Accepted

## Context

The sync logic (doc lifecycle, WS provider with offline queue and backoff, persistence) is the project's core asset and a stated portfolio goal is npm-library-quality design. Coupling it to Expo APIs would make it untestable in plain `bun test` and unpublishable.

## Decision

`@chat-crdt/sync-engine` knows nothing about Expo or React:

- **Storage is injected** through a minimal `IStorage` (`getItem`/`setItem`). The app supplies a ~20-line expo-sqlite adapter; tests use `MemoryStorage`.
- **`yjs` is a peerDependency**, not a dependency. Two copies of Yjs in one bundle break its internal identity checks (`instanceof`, struct integration) in ways that fail silently — the classic dual-instance bug. Peer-depending forces a single copy by construction.
- The provider exposes a `_testSend` hook so protocol tests run without sockets, and `onAuthError` so the host app owns the logout policy.

Why not off-the-shelf providers: `y-websocket` + `y-indexeddb` solve this for browsers, but there is no IndexedDB in RN, and we need control over auth (subprotocol, ADR-003), retry policy (give up on 4xxx codes), and the awareness payload.

## Alternatives Considered

- **`y-websocket` / `y-indexeddb`:** rejected — no RN/SQLite persistence story, auth and retry behavior not ours to shape.
- **Engine imports expo-sqlite directly:** rejected — untestable off-device, dead end for extraction.
- **Bundling `yjs` as a regular dependency:** rejected — invites the dual-instance bug the moment the host app also depends on yjs (it does).

## Consequences

**Good:** full unit coverage in node (all three classes tested, no device or server needed); the package is publishable as-is; storage and transport are swappable seams.

**Bad:** `IStorage` being string-only forces base64 encoding (~33% size overhead — audit 2026-06-12 #6); moving to an incremental update log or BLOB storage requires widening the interface. Consumers must remember to install a compatible `yjs` themselves — the standard peer-dependency tax.
