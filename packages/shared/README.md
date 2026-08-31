# @chat-crdt/shared

Shared DTOs and constants used across chat-crdt's `mobile` and `server` apps
and the `sync-engine` package: `MessageDto`, `UserDto`, `AuthResponse`,
`PresenceState`, `MAX_MESSAGE_LENGTH`, `WsMsgType`.

CJS + types only (no runtime dependencies).

## Install

```sh
npm install @chat-crdt/shared
```

## Usage

```ts
import { MessageDto, MAX_MESSAGE_LENGTH } from '@chat-crdt/shared';

function assertMessage(m: MessageDto) {
  if (m.content.length > MAX_MESSAGE_LENGTH) throw new Error('too long');
}
```

## Publishing

`@chat-crdt/sync-engine` depends on this package with a real semver range
(`^0.1.0`), not a workspace protocol — publish `@chat-crdt/shared` **first**,
then `@chat-crdt/sync-engine`. See
[`packages/sync-engine/README.md`](../sync-engine/README.md#publishing) for
the full publish-order rationale.
