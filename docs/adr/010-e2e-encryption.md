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

- **Room keys are epoch-scoped, not singular.** `Room` gets a `currentKeyId: Int` column (0 = E2EE not yet enabled for this room). Each rotation mints a new symmetric key under the next `keyId`.
- **Grants live in a table, not a single column.** An earlier draft of this ADR put a single `wrappedRoomKey` column on `RoomMember`. That's broken the moment a second epoch exists: a member who joined before a rotation has no way to hold two wrapped keys at once, so they'd lose access to older history the instant the room rotates. Replaced with `RoomKeyGrant { roomId, userId, keyId, wrappedKey }`, one row per (member, epoch) pair that member has actually been granted, keyed `@@id([roomId, userId, keyId])`.
- **Joining members are granted every epoch up to current, not just the current one.** This is a deliberate choice, not an oversight: it preserves the MVP stance that new members can read a room's full history (see Key-rotation trigger list, item 4). Consequence: whoever wraps for a new member must hold every historical epoch's key locally — a member who *themself* joined mid-history and was only ever granted a subset of epochs cannot serve grants for epochs before their own join. Full-history wrapping capability concentrates in whichever members have been present since epoch 0; documented here as a known MVP limitation, not solved by this ADR.
- **Client-side cache:** every unwrapped `(roomId, keyId)` pair the client has been granted is cached in `expo-secure-store` — not just the current epoch, since decrypting history needs the full local set.
- **X25519 keypair:** a `User.publicKey` column holds the public half. The private half is generated on-device and lives only in `expo-secure-store` — see Multi-device / reinstall, below, for what happens when that store is lost.

### Wrap actor and API surface

The server never wraps a key — it never holds plaintext key material, only ciphertext grants it routes. Wrapping is a client operation, done by whichever member currently holds the key(s) a new or under-granted member needs:

- `User.publicKey` is published once, at registration (extend `POST /auth/register`, or a follow-up `PUT /users/me/public-key`).
- `GET /rooms/:id/keys/pending` — `RoomMember` rows missing a `RoomKeyGrant` for one or more epochs the room has reached. Any online client holding those epochs' keys can serve them.
- `POST /rooms/:id/keys` — uploads one or more `RoomKeyGrant` rows (`{userId, keyId, wrappedKey}`), each sealed to the target member's `publicKey`.
- **First-responder pattern:** on connecting to a room, a client checks `GET .../keys/pending` and wraps+uploads for any member it can fully serve. No dedicated server-side wrapper role, no queue — whichever eligible member is online first does it.
- **Async gap, named as a consequence, not solved here:** if nobody holding the needed epoch(s) is online when a member joins (or reinstalls), that member has zero usable grants until someone is. The client renders this as a distinct pending state — see Rendering, below — rather than failing.

### Library: libsodium

`react-native-libsodium` (JSI bindings — no WASM) for two primitives: `crypto_box_seal`/`crypto_box_seal_open` (X25519 sealed box) for key wrapping, and `crypto_aead_xchacha20poly1305_ietf_encrypt`/`_decrypt` for content encryption — **not** `crypto_secretbox`. Correction from an earlier draft: `crypto_secretbox` is XSalsa20-Poly1305, not XChaCha20, and its API has no associated-data parameter. The AEAD variant does: every message binds `{id, roomId, userId, createdAt}` as associated data (AD), so the Poly1305 tag authenticates those fields too, not just the ciphertext bytes — a server that spliced a valid ciphertext under a different `userId`/`roomId`/`createdAt` produces an AD mismatch and fails to decrypt instead of silently succeeding. This closes part of the tamper gap named in Non-Goal 3, at the cost of one extra parameter, not a new primitive.

This mirrors ADR-001's existing rationale for avoiding WASM in Hermes/RN (Automerge was rejected there for exactly that reason) — libsodium's native bindings sidestep the same problem, and one library covers both primitives instead of assembling AES-GCM + X25519 + HKDF from separate lower-level packages.

Alternatives and why not:
- **`tweetnacl-js`** — pure JS, no native acceleration, and JS-engine timing behavior on "constant-time" comparisons is not a guarantee Hermes gives — weaker side-channel posture for a security-sensitive path.
- **`expo-crypto`** — covers hashing and random bytes, not AEAD symmetric encryption or box sealing. Insufficient on its own.
- **`react-native-quick-crypto`** (Node `crypto` polyfill, JSI-based) — viable for AES-GCM, but it's a general-purpose polyfill, not purpose-built for the sealed-box key-wrap primitive this design needs; would still need a separate X25519 box implementation.

### Impact on ADR-005 (extractable sync-engine) and message length

Encryption/decryption happens **above** `@chat-crdt/sync-engine` — `SyncEngine.sendMessage(content: string)` keeps its exact signature, and the engine itself stays crypto-agnostic (no `expo-secure-store`, no key material, fully testable in plain `bun test`). That part of ADR-005's property holds and is unchanged by this revision.

**Correction to an earlier draft's claim:** `MAX_MESSAGE_LENGTH` is not an app-layer check this ADR could simply redirect at plaintext — it is enforced *inside* the engine today (`SyncEngine.sendMessage`, `SyncEngine.ts:25-27`: `if (trimmed.length > MAX_MESSAGE_LENGTH) throw ...`), against whatever string the caller passes as `content`. That check and its 4000-character constant (`packages/shared/src/types.ts:24`) are unchanged by this ADR — widening the engine is out of scope, per ADR-005. Once the app layer passes an encrypted envelope string instead of raw text, that check runs against the *envelope's* length, not the plaintext's, and the envelope is always longer than what it wraps. So the app layer needs its own, smaller, plaintext-side limit, checked before encryption.

Real arithmetic: the AEAD ciphertext is plaintext bytes + 16 (Poly1305 tag); base64 adds ~33%; the envelope's fixed JSON skeleton + discriminator prefix + 32-char base64 nonce is a ~85-byte constant (see the wire format below):

```
envelope_chars ≈ 85 + 1.333 × (plaintext_bytes + 16)
```

Solving for the boundary where `envelope_chars = 4000` (the engine's real, unchanged ceiling): `plaintext_bytes ≈ 2921`. The app layer enforces its own limit well under that edge — **2800 characters**, checked before encryption — leaving headroom for multi-byte UTF-8 (emoji / non-Latin text run several bytes per character, while a naive check counts UTF-16 code units) rather than sitting exactly on the 2921-byte line. This app-layer check is new scope this ADR introduces — it does not exist today — sitting in the send path immediately before the existing `SyncEngine.sendMessage` call. The engine's own 4000-character check still fires too, now as a backstop against envelope bloat rather than the effective user-facing limit: that limit becomes 2800 once E2EE ships for a room.

### Impact on persistence tiers (ADR-006 / ADR-009)

Ciphertext is still just the value of `MessageDto.content` — a plain string — so it rides through both persistence tiers with zero schema change: SQLite (`SQLitePersistence`, client) and `Room.yjsState` (Postgres, server) already store the full encoded `Y.Doc` state as opaque bytes. Softened claim from an earlier draft: this is meaningful at-rest protection for the **server's** copy (DB breach, backup leak, insider — the actual threat model here) but weaker on the **client** tier — the decrypted room key sits in `expo-secure-store` on the same device as the SQLite file holding the ciphertext, so "at rest" there mainly protects against someone reading the raw SQLite file without OS keychain access, not a compromised or rooted device, which can read both.

**ADR-009 epoch compaction still works, explicitly verified:** compaction rebuilds a trimmed snapshot by manipulating `Y.Array` structure (dropping old items) — it never reads `content`, so envelope strings inside items are invisible to it and require no changes. **The 1 MB `yjsState` monitor also needs no change** — `warnIfStateLarge` measures `state.byteLength` on the fully encoded update, agnostic to what's inside `content`.

**Overhead arithmetic** (corrected from an earlier draft's rough "40–60 bytes/message"): per the formula above, each message grows by a ~85-byte constant plus ~33% of its own (plaintext + 16-byte tag) length — roughly `106 + 0.333 × plaintext_bytes` bytes of net overhead, not a flat 40–60. For a typical short message this is a larger relative jump than the earlier estimate implied, so the 1 MB compaction trigger (ADR-009) fires proportionally earlier in an E2EE room's life than previously stated. Still not a design change — just a more accurate shifted threshold.

### Awareness/presence: out of scope for MVP

Typing and presence (`PresenceState` — `userId`, `username`, `roomId`, `isTyping`, `lastSeen`) ride the Yjs awareness protocol (ADR-008), a separate high-churn, short-lived (~30 s expiry) channel from the message CRDT. **Decision: awareness payloads are explicitly not encrypted in MVP.** Two reasons: the server already legitimately knows every field in `PresenceState` — it authenticates room membership via `RoomMember` before a socket ever joins (ADR-003), so `username` is not a new disclosure. And architecturally, bundling AEAD nonce/key-id bookkeeping onto every keystroke-driven typing update (`Awareness`, keyed by ephemeral `clientID`, updated far more often than messages) is real complexity against a threat model that gains nothing from it — the server isn't learning anything from awareness it doesn't already have via membership.

### Wire format: opaque envelope inside `content`

Retracting an earlier draft's claim that `MessageDto` becomes a discriminated shape with new top-level fields (`keyId`/`nonce`/`ciphertext` as siblings of `content`) — that directly contradicted the ADR-005 section above, which requires `MessageDto` and `SyncEngine.sendMessage(content: string)` to stay untouched. They can't both be true; this is the resolution. **`MessageDto` does not change at all.** `content: string` remains a plain string; when a room is E2EE-enabled, its *value* is a JSON envelope:

```ts
// content = 'E2E1' + JSON.stringify(envelope)
interface E2eeEnvelope {
  v: 1;
  keyId: number;       // epoch this message is encrypted under
  nonce: string;        // base64, 24 random bytes — the AEAD nonce
  ciphertext: string;   // base64 — includes the 16-byte Poly1305 tag
}
```

The `'E2E1'` prefix (a control character no keyboard produces, followed by a fixed tag) is the discriminator: on read, a client checks for the prefix before attempting to parse the remainder as an envelope. No prefix → legacy plaintext, render as-is. Prefix present → parse and decrypt, or fall into one of the Rendering states below if the needed key isn't available yet. `id`, `roomId`, `userId`, `username`, `createdAt` stay exactly where ADR-002 already put them, at the `MessageDto` level — never inside the envelope.

**Nonce:** 24 random bytes from `randombytes_buf` (libsodium's CSPRNG), generated fresh per message — explicitly never a counter. A counter needs coordinated, monotonic state across every device that might send under the same key; this is an offline-first, multi-writer CRDT (two devices can be offline simultaneously and both increment from the same last-seen value) and devices can lose all local state on reinstall (see below) — either case collides a counter back onto an already-used value under the same key, which is catastrophic for any stream cipher including XChaCha20. Random 24-byte nonces make collision probability negligible without coordination — the entire reason XChaCha20 (24-byte nonce space) was chosen over a 12-byte-nonce cipher for a multi-writer setting.

### Rendering undecryptable items

Three distinct cases, rendered differently so failure modes aren't confused with each other or with normal messages:
- **No envelope prefix** → legacy plaintext (pre-E2EE, or an E2EE-disabled room). Render as-is, unchanged behavior.
- **Envelope present, `keyId` not in local cache, and no pending grant exists for it** (an epoch that predates this client and nobody has served it) → "key unavailable" placeholder, non-fatal.
- **Envelope present, client is a member but holds zero grants yet** (fresh join or post-reinstall, waiting on a first-responder wrapper — see Wrap actor and Multi-device) → "waiting for encryption key" placeholder, distinct copy from the case above.

### Multi-device / reinstall

One X25519 keypair, private half only in `expo-secure-store` — device-local, not synced to an iCloud/Google-account keychain in this design. Reinstalling the app, or moving to a new device, destroys the private key with no recovery path: every `RoomKeyGrant` ever sealed to that user's old public key becomes permanently unusable (the server holds ciphertext for a private key that no longer exists anywhere). **Chosen MVP stance: accept the loss.** The user re-registers a new `publicKey`, and re-enters the same first-responder wrapper flow as a brand-new joiner, in every room they were a member of — no key backup, no escrow, no recovery flow in MVP. This is a real UX cost (a reinstall can block on another member being online, per room) named here rather than solved.

### Key-rotation trigger list

**Rotation authority (deterministic, server-mediated):** the server owns `Room.currentKeyId` and allocates the next epoch via a conditional update — `UPDATE "Room" SET "currentKeyId" = "currentKeyId" + 1 WHERE id = :roomId AND "currentKeyId" = :expected`. Only the client whose `expected` still matches wins (1 row affected); a client that raced and lost (0 rows affected) re-reads the new `currentKeyId` and re-wraps its own pending rotation reason under that number instead of minting a second, colliding epoch. This makes concurrent rotations deterministic by construction — no two clients can ever be allocated the same `keyId`.

1. **Member removed / kicked.** Mandatory: claim the next `keyId`, generate a new room key, wrap+upload a `RoomKeyGrant` for every remaining member. A removed member is never granted the new epoch, so they cannot decrypt anything sent after their removal (messages already synced under earlier epochs remain locally readable to them — already-disclosed information, not a new leak; see Non-Goals on forward secrecy). **Forward-looking, flagged honestly:** `RoomsService` has no `removeMember` endpoint today — this trigger describes a design target for when that API ships, not existing behavior.
2. **Member voluntarily leaves.** Same handling as removal; same forward-looking caveat — no leave endpoint exists yet either.
3. **Manual "reset room key"** — user-triggered, for suspected device/key compromise.
4. **Explicitly not a trigger: new member joins.** Per Key management above, a new member is granted every epoch up to current (full history), so no rotation is needed on join.
5. **Explicitly not a trigger: time/periodic rotation, or reinstall.** No scheduled rekeying (see Non-Goals). A reinstalled member is handled by re-granting under existing epochs to their new public key (Multi-device, above), not by rotating.

### Migration note for existing plaintext history

No production message data predates this ADR, so there is no backfill to run at ship time. For any pre-E2EE data that does exist (dev/staging rooms), the wire format above handles it without a migration script: an item whose `content` has no `'E2E1'` prefix renders as legacy plaintext. Re-encrypting existing history in place is deliberately rejected — `Y.Array` items are pushed once and never mutated (ADR-002), so "fixing" old items would mean deleting and re-inserting them with new CRDT identities, which is exactly the duplication trap ADR-009 already identified and ruled out for trimming. Mixed plaintext/ciphertext history within one array is an acceptable permanent state, not a temporary migration window.

## Non-Goals (MVP)

1. **No forward secrecy — no Double Ratchet, no per-message ephemeral keys.** A static key per epoch (rotated only on membership change, see above) is sufficient against an honest-but-curious server that isn't actively trying to recover past traffic after a future compromise. Per-message ratcheting adds ratchet-state management and out-of-order-delivery handling disproportionate to that threat model. Revisit if the threat model expands to active/malicious-server or device-compromise-recovery guarantees.
2. **No MLS (Messaging Layer Security).** MLS earns its keep at large, frequently-changing group sizes where O(log n) rekeying matters. Rooms here are small (`RoomMember`-gated chat rooms, not broadcast channels); the rotation trigger list above is membership-change-only, and a simple O(members) "new key, reseal for each remaining member" rotation is cheap at this scale. Revisit if room sizes grow into the hundreds+.
3. **No message signatures / sender-authenticity beyond AEAD associated-data binding.** The AEAD tag covers not just the ciphertext but the associated data `{id, roomId, userId, createdAt}` bound to it (see Library, above) — a server that splices a valid ciphertext under a different `userId`/`roomId`/`createdAt` produces an AD mismatch and fails to decrypt, not silent corruption. What AD binding does *not* give: proof the ciphertext really originated from the claimed `userId` in the first place — AD is data the decryptor insists must match, not a signature over who wrote it. A fully malicious server could still forge an entire envelope (fresh nonce, valid AEAD tag over attacker-chosen plaintext and AD) and claim it came from any `userId` it likes. Closing that gap needs per-message signing (e.g., Ed25519 over the same fields) — out of scope because it defends against a server forging messages outright, not the honest-but-curious one this ADR targets.
4. **No metadata protection.** `roomId`, `userId`, `username`, `createdAt`, message ordering, and message count all stay visible to the server — they're operationally required (CRDT tie-break, `RoomMember` auth, rate limiting, persistence keys) and were never in scope for confidentiality here. Traffic analysis is explicitly out of scope.
5. **No key-verification UI (no safety-number / fingerprint comparison).** MVP trusts server-mediated public-key distribution (`User.publicKey`) at face value. This is the honest weak point against an actively malicious server (it could hand out a substituted public key and MITM the room-key wrapping) — consistent with the stated honest-but-curious scope, but worth naming so it isn't mistaken for a stronger guarantee.

## Alternatives Considered

- **(b) Full-document encryption (server as blind relay):** rejected as the primary approach — see Decision. It's the correct design if the threat model ever becomes "don't trust the server with *anything* including CRDT structure," but it requires replacing the sync protocol (ADR-004's delta fan-out, ADR-009's server-side compaction), not extending it. Worth a future ADR of its own if the threat model changes.
- **Out-of-band key sharing (QR code / manual passphrase per room):** rejected — doesn't scale to the existing invite/join flow (`POST /rooms/:name/join`), and reintroduces a manual step every member must complete outside the app.
- **Server-held keys with access control only (no E2EE, rely on TLS + auth):** rejected — this is the status quo, and it's exactly what an honest-but-curious server (DB breach, insider, subpoena) defeats; it's the premise of the ticket, not an alternative to it.
- **Single `wrappedRoomKey` column on `RoomMember` (no epoch table):** rejected — see Key management. Cannot represent more than one live epoch, so it breaks on the first rotation for anyone who joined before it.
- **Signal-style X3DH + Double Ratchet per-message keys:** rejected for MVP — see Non-Goals #1. Real option if forward secrecy becomes a requirement.

## Consequences

**Good:** message content is unreadable from Postgres, Redis, server logs, or backups without a member's unwrapped room key(s); every existing sync ADR (001/004/005/006/009) keeps working unmodified because Yjs structure — and now `MessageDto` itself — stays untouched; `sync-engine` stays crypto-agnostic and Expo-free (ADR-005 preserved); AEAD with associated-data binding gives both ciphertext integrity and userId/roomId/createdAt tamper-detection for free; key wrapping means the server is custodial, not a holder of any plaintext key material at any point.

**Bad:** two new columns/tables (`User.publicKey`, `Room.currentKeyId`, `RoomKeyGrant`) and three new endpoints (`PUT /users/me/public-key`, `GET /rooms/:id/keys/pending`, `POST /rooms/:id/keys`), plus a real client-side key-management surface (generate, cache every granted epoch, wrap for pending members, rotate) — none of which exists today; real implementation cost when this ADR is executed. New and reinstalled members can read full history by design (Key management, above) — a product call that may need revisiting. Members who joined mid-history and were only granted a subset of epochs cannot wrap for earlier epochs — full-history wrapping capability concentrates in whoever has been present since epoch 0. Reinstall/new-device destroys the local keypair with no recovery — accepted as an MVP stance (Multi-device, above), not solved. AEAD associated-data binding closes the userId-splicing tamper gap but not sender forgery by an actively malicious server (Non-Goal 3), nor public-key substitution (Non-Goal 5). Rotation on every membership-change trigger requires every remaining member's client to re-wrap and upload a new `RoomKeyGrant` row — cheap at current room sizes, a cost worth re-measuring if rooms grow (Non-Goal 2). Async gap: a new or reinstalled member has no usable grant until some online member with the needed epoch(s) serves them (Wrap actor, above).
