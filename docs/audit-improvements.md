# Audit & Improvements

Audit date: 2026-06-07. Scope: full stack — NestJS server (WS sync gateway, auth, Prisma, Redis), `sync-engine` package, Expo mobile app.

Findings ordered by severity. Each item: location, problem, fix.

## Status (updated 2026-06-08, branch `feat/room-auth`)

| # | Severity | Status |
|---|----------|--------|
| 1 WS URL double-? | 🔴 | ✅ Fixed |
| 2 Redis full-state fan-out | 🔴 | ✅ Fixed (+ fixed same-instance broadcast gap) |
| 3 Presence across instances | 🟠 | ✅ Fixed |
| 4 Room authorization | 🟠 | ✅ Fixed (`RoomMember` model, `POST /rooms`, 4003 on WS) |
| 5 JWT in query string | 🟠 | ✅ Fixed (Sec-WebSocket-Protocol) |
| 6 No rate limiting | 🟠 | ✅ Fixed (throttler + WS caps) |
| 7 JWT_SECRET not validated | 🟠 | ✅ Fixed (zod env schema) |
| 8 WS retry never gives up | 🟡 | ✅ Fixed |
| 9 SQLite full-doc write | 🟡 | ✅ Fixed (debounced) |
| 10 atob/btoa in RN | 🟡 | ✅ Fixed (guarded polyfill) |
| 11 Email not normalized | 🟡 | ✅ Fixed |
| dist committed | 🟢 | ✅ Already gitignored on base |
| scrollToEnd jank | 🟢 | ✅ Fixed (auto-scroll only when at bottom) |
| Dead Message table | 🟢 | ✅ Dropped — model removed, schema clean |
| JwtStrategy unused | 🟢 | ✅ Fixed — JwtAuthGuard guards `/rooms` routes |
| yjsState pruning | 🟢 | ⏸ Deferred — needs snapshot/GC strategy |

---

## 🔴 Critical

### 1. WebSocket URL double `?` → sync auth always fails

The app's real WebSocket connection never authenticates. Sync only works in tests (which bypass `connect()` via `_testSend`).

- `apps/mobile/src/hooks/useSync.ts` passes `url: ${WS_URL}?room=${ROOM_ID}` → `ws://…/sync?room=default`
- `packages/sync-engine/src/WebSocketProvider.ts` `connect()` appends `?token=${token}` → `…/sync?room=default?token=XXX`
- `apps/server/src/sync/sync.gateway.ts` `handleConnection`: `searchParams.get('token')` returns `null` (second `?` is not a separator). `room` becomes `"default?token=XXX"`. `jwt.verify('')` throws → `client.close(4001)`.

**Fix:** build the URL once with `URLSearchParams` (or use `&` for token). Pass room + token from a single place.

### 2. Redis fan-out ships FULL doc state every message — mislabeled "incremental"

- `apps/server/src/sync/sync.gateway.ts` `handleMessage`: `const update = Y.encodeStateAsUpdate(room.doc)` encodes the entire document, then publishes to Redis + schedules persist on every sync message.
- O(n) per message → quadratic bandwidth / CPU / storage as history grows. Comment claims "incremental update that was just applied" — false.

**Fix:** capture the true delta via `room.doc.on('update', (u, origin) => …)` keyed by transaction origin; publish only `u`.

---

## 🟠 High

### 3. Presence broken across instances — defeats the Redis design

- Awareness handled local-only. Redis carries `room:update:*` (doc updates) but no awareness channel → multi-instance deploy shows wrong online count + typing per node.
- `handleDisconnect` never calls `awarenessProtocol.removeAwarenessStates` → ghost online users + stuck typing indicators after disconnect.
- New client receives no awareness snapshot on connect → `onlineCount` wrong until next change.

**Fix:** add a Redis awareness channel; remove awareness states on disconnect; send current awareness snapshot in `handleConnection`.

### 4. No room authorization

Any valid JWT can join any room. No membership / ACL check. `roomId` defaults to `'default'`, fully open.

**Fix:** check room membership before `getOrCreateRoom`.

### 5. JWT in URL query string

Client + server both put the token in the query string. Leaks into access logs, proxies, browser history.

**Fix:** move to `Sec-WebSocket-Protocol` header or a first-message auth frame.

### 6. No rate limiting anywhere

- Auth endpoints (`/auth/login`) brute-forceable — no `@nestjs/throttler`.
- WS: no message rate / size cap, no content length limit → memory DoS (Yjs array unbounded, `MessageDto.content` never validated).

**Fix:** add throttler on auth; cap WS message size + per-client rate; validate content length.

### 7. JWT_SECRET not validated at boot

`apps/server/src/auth/jwt.strategy.ts` / `auth.module.ts`: `config.get('JWT_SECRET')` — if unset, `jwt.sign` runs with `undefined` secret → insecure or crash.

**Fix:** validate required env presence on startup (e.g. Joi/Zod schema in `ConfigModule`).

---

## 🟡 Medium

### 8. WS retry never gives up on auth failure

`packages/sync-engine/src/WebSocketProvider.ts` `scheduleRetry` reconnects on any close, including `4001 Unauthorized`. Expired/bad token = infinite backoff loop.

**Fix:** stop retrying on 4xx close codes; trigger logout / token refresh.

### 9. SQLitePersistence writes full base64 of whole doc on every update, no debounce

`packages/sync-engine/src/SQLitePersistence.ts` `docUpdateHandler` rebuilds the entire state per message on the JS thread. Same O(n) growth as #2.

**Fix:** debounce writes; consider an incremental update log.

### 10. `atob` / `btoa` used in RN runtime

`WebSocketProvider.onmessage`, `SQLitePersistence`. Hermes lacks these without a polyfill → crash.

**Fix:** confirm a base64 polyfill is loaded, or use `Buffer` / a known-available API.

### 11. Email / username not normalized

`apps/server/src/auth/auth.service.ts`: no lowercasing → `Foo@x.com` vs `foo@x.com` register as distinct accounts. `findUnique` is case-sensitive.

**Fix:** normalize (trim + lowercase) before lookup/create.

---

## 🟢 Low / cleanup

- **`dist/` committed to git** (`sync-engine/dist`, `shared/dist`, `server/dist`). Add to `.gitignore`.
- **Postgres `Message` table dead** — only `yjsState` blob persisted; `RoomState.getMessages()` unused. Wire relational persistence or drop the model.
- **`JwtStrategy` effectively unused** — no `JwtAuthGuard` on any HTTP route (only public auth routes exist).
- **`scrollToEnd` on every `onContentSizeChange`** (`apps/mobile/app/(chat)/index.tsx`) fights user scroll-up; jank on long lists.
- **No yjsState pruning** — Yjs tombstones grow unbounded over room lifetime.

---

## Suggested order

1. Fix #1 (sync broken) + #2 (full-state fan-out) — one focused PR each.
2. Presence correctness (#3).
3. Security hardening: #4, #5, #6, #7.
4. Resilience + cleanup: #8–#11, low items.
