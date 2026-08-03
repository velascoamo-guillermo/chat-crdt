# ADR-010: E2E message encryption — per-field content encryption, libsodium, honest-but-curious server

**Date:** 2026-08-04
**Status:** Accepted

## Context

Roadmap staff feature: end-to-end encryption for message content. This is non-trivial specifically because of the CRDT architecture: the server is not a passive store, it is an active Yjs participant. `SyncGateway` (`apps/server/src/sync/sync.gateway.ts`) holds a live `Y.Doc` per room (`RoomState`), applies every client's incremental update via `syncProtocol.readSyncMessage`, fans out true deltas over Redis (ADR-004), persists debounced full-state snapshots to `Room.yjsState: Bytes` (ADR-006), and — per ADR-009 — will eventually rebuild trimmed snapshots server-side for epoch compaction. All of that requires the server to decode Yjs's own structural encoding (struct ids, client clocks, array positions). It does **not** require the server to understand the *content* of a `MessageDto`.

`MessageDto` (`packages/shared/src/types.ts`) is a flat object pushed once into a `Y.Array<MessageDto>` (`SyncEngine.sendMessage` in `packages/sync-engine/src/SyncEngine.ts`) — never mutated in place, only appended. That immutable, append-only shape matters: it means encryption can target one field of the object without touching how the CRDT itself merges.

Threat model for this ADR: **honest-but-curious server**. The operator (us, or whoever has DB/Redis/backup/log access) does not tamper with traffic but could read anything that reaches Postgres, Redis, or server memory — a data breach, a subpoena, an insider, or a misconfigured backup. E2EE's job here is to make message *content* unreadable from any of those vantage points. It is explicitly **not** a defense against a compromised client device, and — see Non-Goals — only partially a defense against an actively malicious server.

Key distribution has to interact with the existing `RoomMember` model (`apps/server/prisma/schema.prisma`): membership is the only concept of "who is in this room" the system has, and room access is already gated on it (ADR-003 checks `RoomsService.isMember` before a socket joins).

## Decision

### Chosen approach: (a) per-field content encryption — not (b) full-document encryption

Encrypt `MessageDto.content` before it enters the CRDT; leave `id`, `roomId`, `userId`, `username`, `createdAt`, and the Yjs structural encoding itself in plaintext. The server keeps decoding and operating on `Y.Doc`/`Y.Array` exactly as it does today — it just never understands the string sitting in one field of each item.

This is a real recommendation, not a coin flip between (a) and (b):

- **(b) full-document encryption would break the sync protocol that already ships.** ADR-004's true-delta fan-out and ADR-009's planned epoch compaction both work by having the server decode Yjs updates (`Y.applyUpdate`, `syncProtocol.readSyncMessage`, `Y.encodeStateAsUpdate`) and, for compaction, rebuild a doc with fewer items. If the entire encoded update is ciphertext, the server cannot do any of that — it degrades to a byte-blind relay that can only forward and store opaque blobs. That's a valid architecture (Matrix/Signal-style sealed-sender relays use it), but it is a different server, not an incremental change: it gives up incremental diffing (state-vector sync becomes "send everything, every time" unless the client does its own diffing before encrypting each delta), gives up meaningful `yjsState` byte-size monitoring as a compaction trigger, and gives up server-driven epoch compaction entirely (ADR-009's compaction rebuilds a trimmed doc server-side — impossible without decoding it).
- **(a) leaves every existing sync ADR's mechanism intact.** The server still merges, still fans out true deltas, still persists snapshots it can size and eventually compact — it just never looks at `content`. Since the honest-but-curious threat model only requires hiding message *text* (metadata like `roomId`/`userId`/`createdAt` was never confidential — the server needs it for CRDT tie-break and `RoomMember` auth regardless), (a) matches the actual protection goal with the smallest blast radius on the existing architecture.

### Key management

- **One symmetric key per room** (XChaCha20-Poly1305, via libsodium's `crypto_secretbox`), generated client-side by the room creator.
- **Distribution via per-user public-key wrapping**, not out-of-band sharing. This needs two additions beyond what exists today:
  - `User` gets a `publicKey: Bytes` column — an X25519 public key generated on-device at registration/first-run, private half kept only in `expo-secure-store` (already a dependency, already used for the auth token per ADR-008).
  - `RoomMember` gets a `wrappedRoomKey: Bytes` column — the room key sealed to that member's public key with libsodium's `crypto_box_seal` (anonymous sealed box: sender doesn't need the recipient online, and the server that stores the wrapped blob cannot open it — it never holds any user's private key).
  - On join, the server hands the new member their `wrappedRoomKey` row (already fetched alongside membership); the client unseals it locally with its `expo-secure-store`-held private key. The server's role stays purely custodial — it stores and routes wrapped keys it cannot read.
- **Client-side cache:** the unwrapped per-room symmetric key is cached in `expo-secure-store`, keyed by `roomId` + `keyId` (below), mirroring how the auth token is already stored per ADR-008.

### Library: libsodium

`react-native-libsodium` (JSI bindings — no WASM) for both primitives: `crypto_box_seal`/`crypto_box_seal_open` for key wrapping, `crypto_secretbox_easy`/`crypto_secretbox_open_easy` for content AEAD. This mirrors ADR-001's existing rationale for avoiding WASM in Hermes/RN (Automerge was rejected there for exactly that reason) — libsodium's native bindings sidestep the same problem, and one library covers both primitives instead of assembling AES-GCM + X25519 + HKDF from separate lower-level packages.

Alternatives and why not:
- **`tweetnacl-js`** — pure JS, no native acceleration, and JS-engine timing behavior on "constant-time" comparisons is not a guarantee Hermes gives — weaker side-channel posture for a security-sensitive path.
- **`expo-crypto`** — covers hashing and random bytes, not AEAD symmetric encryption or box sealing. Insufficient on its own.
- **`react-native-quick-crypto`** (Node `crypto` polyfill, JSI-based) — viable for AES-GCM, but it's a general-purpose polyfill, not purpose-built for the sealed-box key-wrap primitive this design needs; would still need a separate X25519 box implementation.

### Impact on ADR-005 (extractable sync-engine)

Encryption/decryption happens **above** `@chat-crdt/sync-engine`, not inside it. `SyncEngine.sendMessage(content: string)` keeps its current signature and keeps treating `content` as an opaque string — the caller (app layer) passes already-encrypted content in, and decrypts what `getMessages()`/`subscribe()` hands back. This preserves ADR-005's core property: the sync-engine package stays Expo-free and testable in plain `bun test` with `MemoryStorage`, no `expo-secure-store` or key material anywhere near it. `MAX_MESSAGE_LENGTH` (`packages/shared`) must be validated against **plaintext** length before encryption, since ciphertext length differs (nonce + MAC overhead) — this check moves to the app-layer send path, ahead of the `SyncEngine.sendMessage` call it already precedes today.

### Impact on persistence tiers (ADR-006 / ADR-009)

Because ciphertext just replaces the value of one string-ish field inside an otherwise-unchanged `MessageDto`, it rides through both persistence tiers for free: SQLite (`SQLitePersistence`, client) and `Room.yjsState` (Postgres, server) already store the full encoded `Y.Doc` state as opaque bytes/base64 — content ciphertext inside that blob doesn't require a schema change on either tier, and doubles as at-rest encryption for message text specifically (metadata fields stay plaintext at rest, consistent with the threat model — this was never meant to hide who's in a room from the DB).

**ADR-009 epoch compaction still works, explicitly verified:** compaction rebuilds a trimmed snapshot by manipulating `Y.Array` structure (dropping old items, assigning a new epoch) — it never needs to read `content`, so ciphertext inside items is invisible to that mechanism and requires no changes. **The 1 MB `yjsState` monitor (`YJS_STATE_WARN_BYTES` in `sync.gateway.ts`) also needs no change** — it measures `state.byteLength` on the fully encoded update, agnostic to what's inside `content`. One second-order consequence worth flagging: ciphertext (nonce + Poly1305 MAC + key-id overhead, ~40–60 bytes/message) makes each message larger than its plaintext equivalent, so the 1 MB compaction trigger fires somewhat earlier in a room's life than it would without E2EE. Not a design change, just a shifted threshold.

### Awareness/presence: out of scope for MVP

Typing and presence (`PresenceState` — `userId`, `username`, `roomId`, `isTyping`, `lastSeen`) ride the Yjs awareness protocol (ADR-008), a separate high-churn, short-lived (~30 s expiry) channel from the message CRDT. **Decision: awareness payloads are explicitly not encrypted in MVP.** Two reasons: the server already legitimately knows every field in `PresenceState` — it authenticates room membership via `RoomMember` before a socket ever joins (ADR-003), so `username` is not a new disclosure. And architecturally, bundling AEAD nonce/key-id bookkeeping onto every keystroke-driven typing update (`Awareness`, keyed by ephemeral `clientID`, updated far more often than messages) is real complexity against a threat model that gains nothing from it — the server isn't learning anything from awareness it doesn't already have via membership.

### Wire-format sketch

`MessageDto.content: string` becomes a discriminated shape — legacy plaintext items (no `keyId`) render as-is; encrypted items carry:

```ts
interface EncryptedMessageDto {
  id: string;          // ULID — plaintext, unchanged (CRDT tie-break, ADR-002)
  roomId: string;       // plaintext
  userId: string;       // plaintext — sender identity; server already knows it via RoomMember
  username: string;     // plaintext — see Awareness decision, same exposure already exists
  createdAt: number;    // plaintext
  keyId: number;         // room-key epoch this message is encrypted under
  nonce: string;         // base64, 24 bytes — crypto_secretbox nonce, unique per message
  ciphertext: string;    // base64 — crypto_secretbox_easy(plaintext, nonce, roomKey[keyId])
}
```

### Key-rotation trigger list

1. **Member removed / kicked.** Mandatory: generate a new room key (`keyId + 1`), re-wrap it for every remaining member, so a removed member cannot decrypt any message sent after their removal. (Messages they already synced under the old key remain readable to them locally — that's already-disclosed information, not a new leak; see Non-Goals on forward secrecy.)
2. **Member voluntarily leaves.** Same handling as removal.
3. **Manual "reset room key"** — user-triggered, for suspected device/key compromise.
4. **Explicitly not a trigger: new member joins.** The new member receives the *current* `keyId`'s wrapped key and can therefore decrypt the room's full history, same as any existing member. No history-hiding-from-new-joiners in MVP — call this out as a deliberate scope bound, matching how most team-chat products treat channel history.
5. **Explicitly not a trigger: time/periodic rotation.** No scheduled rekeying — see Non-Goals.

### Migration note for existing plaintext history

No production message data predates this ADR, so there is no backfill to run at ship time. For any pre-E2EE data that does exist (dev/staging rooms), the discriminated wire format handles it without a migration script: an item with no `keyId` renders as legacy plaintext. Re-encrypting existing history in place is deliberately rejected — `Y.Array` items are pushed once and never mutated (ADR-002), so "fixing" old items would mean deleting and re-inserting them with new CRDT identities, which is exactly the duplication trap ADR-009 already identified and ruled out for trimming. Mixed plaintext/ciphertext history within one array is an acceptable permanent state, not a temporary migration window.

## Non-Goals (MVP)

1. **No forward secrecy — no Double Ratchet, no per-message ephemeral keys.** A static key per epoch (rotated only on membership change, see above) is sufficient against an honest-but-curious server that isn't actively trying to recover past traffic after a future compromise. Per-message ratcheting adds ratchet-state management and out-of-order-delivery handling disproportionate to that threat model. Revisit if the threat model expands to active/malicious-server or device-compromise-recovery guarantees.
2. **No MLS (Messaging Layer Security).** MLS earns its keep at large, frequently-changing group sizes where O(log n) rekeying matters. Rooms here are small (`RoomMember`-gated chat rooms, not broadcast channels); the rotation trigger list above is membership-change-only, and a simple O(members) "new key, reseal for each remaining member" rotation is cheap at this scale. Revisit if room sizes grow into the hundreds+.
3. **No message signatures / sender-authenticity beyond the existing JWT session.** AEAD (the Poly1305 MAC inside `crypto_secretbox`) already gives ciphertext integrity — a tampered ciphertext fails to decrypt, so silent content corruption by the server is already detected for free. What's *not* covered: a fully malicious server splicing a valid ciphertext under a different `userId` field, since nothing binds `userId` to the ciphertext cryptographically. Closing that gap needs per-message signing (e.g., Ed25519 over `{roomId, userId, ciphertext}`) — out of scope because it defends against an actively malicious server, not the honest-but-curious one this ADR targets.
4. **No metadata protection.** `roomId`, `userId`, `username`, `createdAt`, message ordering, and message count all stay visible to the server — they're operationally required (CRDT tie-break, `RoomMember` auth, rate limiting, persistence keys) and were never in scope for confidentiality here. Traffic analysis is explicitly out of scope.
5. **No key-verification UI (no safety-number / fingerprint comparison).** MVP trusts server-mediated public-key distribution (the `User.publicKey` column) at face value. This is the honest weak point against an actively malicious server (it could hand out a substituted public key and MITM the room-key wrapping) — consistent with the stated honest-but-curious scope, but worth naming so it isn't mistaken for a stronger guarantee.

## Alternatives Considered

- **(b) Full-document encryption (server as blind relay):** rejected as the primary approach — see Decision. It's the correct design if the threat model ever becomes "don't trust the server with *anything* including CRDT structure," but it requires replacing the sync protocol (ADR-004's delta fan-out, ADR-009's server-side compaction), not extending it. Worth a future ADR of its own if the threat model changes.
- **Out-of-band key sharing (QR code / manual passphrase per room):** rejected — doesn't scale to the existing invite/join flow (`POST /rooms/:name/join`), and reintroduces a manual step every member must complete outside the app.
- **Server-held keys with access control only (no E2EE, rely on TLS + auth):** rejected — this is the status quo, and it's exactly what an honest-but-curious server (DB breach, insider, subpoena) defeats; it's the premise of the ticket, not an alternative to it.
- **Signal-style X3DH + Double Ratchet per-message keys:** rejected for MVP — see Non-Goals #1. Real option if forward secrecy becomes a requirement.

## Consequences

**Good:** message content is unreadable from Postgres, Redis, server logs, or backups without a member's unwrapped room key; every existing sync ADR (001/004/005/006/009) keeps working unmodified because Yjs structure stays plaintext; `sync-engine` stays crypto-agnostic and Expo-free (ADR-005 preserved); ciphertext integrity (AEAD) is free confirmation against silent corruption; key wrapping means the server is custodial, not a holder of any plaintext room key.

**Bad:** two new columns (`User.publicKey`, `RoomMember.wrappedRoomKey`) and a client-side key-management surface (generate, unwrap, cache, rotate) that doesn't exist today — real implementation cost when this ADR is executed. New members can read full room history by design (Non-Goal #4 above) — a product call that may need revisiting. No defense against an actively malicious server splicing sender identity (Non-Goal #3) or substituting public keys (Non-Goal #5) — those are named, accepted gaps, not oversights. Rotation on every membership change means every remaining member's client must re-wrap and the server must store a new `wrappedRoomKey` row per member per rotation — cheap at current room sizes, a cost worth re-measuring if rooms grow (see Non-Goal #2).
