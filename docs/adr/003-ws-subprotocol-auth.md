# ADR-003: JWT via `Sec-WebSocket-Protocol`, verified before room join

**Date:** 2026-06-12
**Status:** Accepted (implemented in `feat(sync): presence across instances, subprotocol auth, rate limits`)

## Context

The WebSocket browser/RN API cannot set an `Authorization` header. The first implementation passed the JWT in the URL query string, which leaks tokens into access logs, proxies, and crash reports — flagged 🟠 in the 2026-06-07 audit.

## Decision

The client offers subprotocols `["bearer", <jwt>]`; the server parses `Sec-WebSocket-Protocol`, verifies the JWT, and checks `RoomMember` membership **before** the room doc is loaded or the socket joins anything. Failures close with semantic codes: `4001` (bad token — client logs out instead of retrying), `4003` (not a member).

Why this over the obvious runner-up (auth as first message): with subprotocol auth, an unauthenticated socket never reaches application state — no timer to expel idle pre-auth sockets, no "connected but not yet authed" state machine on either side. The token rides the upgrade request's headers, which TLS protects and access logs don't record.

## Alternatives Considered

- **Query string:** rejected — token in logs/proxies/history. The original sin this replaces.
- **First-message auth frame:** rejected — requires accepting unauthenticated sockets, an idle-kick timer, and a pre-auth state on both ends. More machinery for no security gain.
- **Cookie:** rejected — no ergonomic cookie story in React Native, and ties WS auth to web session semantics we don't have.

## Consequences

**Good:** token never appears in a URL; rejection happens before any per-room resources are allocated; distinct close codes drive correct client behavior (4001 → logout, others → backoff retry).

**Bad:** mild abuse of subprotocol semantics — the token is not a protocol name. Interop cost is theoretical (we control both ends), but any future non-`ws`-library client must replicate the `"bearer, <jwt>"` convention. JWTs are 7-day bearer tokens with no refresh flow; revocation before expiry requires a secret rotation.
