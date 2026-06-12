# ADR-008: Zustand for client state; ephemeral state rides Yjs awareness

**Date:** 2026-06-12
**Status:** Accepted

## Context

The client needs three kinds of state: session (token/user), chat UI state (messages projection, connection status), and ephemeral presence (who is online, who is typing). Messages themselves already have a source of truth — the Yjs doc (ADR-002) — so whatever "state management" we add must be a projection layer, not another owner.

## Decision

- **Two small Zustand stores**: `auth.store` (token + user, hydrated from `expo-secure-store`) and `chat.store` (message array + WS status). `useSync` wires them: `engine.subscribe(setMessages)` makes the store a dumb projection of the CRDT.
- **Presence and typing never touch a store-fetch cycle** — they ride the Yjs **awareness protocol** on the existing WebSocket. Awareness states auto-expire (~30 s), so a crashed peer's "typing…" clears itself without any cleanup code on our side.
- **No TanStack Query**, despite it being the house default elsewhere.

Why no Query here: TanStack Query manages request/response server state — caching, invalidation, refetch. This app's server state arrives as a **push stream merged by a CRDT**; there is nothing to invalidate or refetch (the sync handshake is the refetch, and Yjs is the cache). The only request/response calls are login/register — two fetches that write into the auth store. Query would be machinery without a job.

## Alternatives Considered

- **TanStack Query:** rejected for the sync path (wrong model, see above); overkill for two auth mutations.
- **Redux Toolkit:** rejected — ceremony without payoff at two stores; no middleware needs.
- **React Context only:** rejected — message updates would re-render the whole subtree; Zustand selectors give per-slice subscription for free.

## Consequences

**Good:** the data flow is one straight line (Y.Array → subscribe → store → FlashList) with one owner per datum; presence reuses the existing transport and self-heals; stores are small enough to read in one sitting.

**Bad:** Zustand stores are module-level singletons keyed to the single-room MVP (`ROOM_ID = 'default'` lives in `useSync`). Multi-room support forces a rework — store-per-room or keyed maps — and that boundary should get its own ADR when it happens.
