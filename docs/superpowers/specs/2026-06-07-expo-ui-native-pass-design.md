# Native UI pass with @expo/ui — Design

Date: 2026-06-07
Status: Approved
Scope: `apps/mobile` view layer only

## Goal

Replace the plain React Native `StyleSheet` UI with native components from
`@expo/ui` (SwiftUI on iOS, Jetpack Compose on Android), driving text inputs with
`useNativeState` so keystrokes render on the native thread. Strategy **B (hybrid)**:
nativize every surface a user touches, keep `FlashList` + RN bubbles for the
scrolling CRDT message feed (perf-critical, recycling-dependent).

## Constraints / decisions

- `@expo/ui` (56.0.16) `<Host>` views are native islands; they do **not** flex-compose
  inline with arbitrary RN views and **cannot** be `FlashList` cells. → islands sit
  top/bottom of a vertical RN layout; `FlashList` stays a plain RN view in the middle.
- Build on the **universal** entrypoint `@expo/ui/universal` (one API, iOS + Android):
  `Host, Row, Column, Text, Button, TextInput, Icon, Spacer, List, useNativeState`.
  `Form / Menu / SecureField` are iOS-only (`swift-ui`) and are **not** used — forms
  are composed from `Column` + `TextInput`.
- Both platforms (iOS + Android) in parity, single codebase, no `.ios`/`.android` files.
- Stores/hooks (`useSync`, `usePresence`, zustand stores) are **untouched** — only the
  view layer changes.

## Architecture

```
src/ui/
  index.ts        re-exports @expo/ui/universal primitives + theme. ONLY place that imports @expo/ui.
  theme.ts        design tokens (colors, radius). Consumed by native props + RN bubbles.
src/components/
  ChatHeader.tsx  native Host island (Row): room name, status dot, online count, logout Button.
  Composer.tsx    native Host island (Row): TextInput (useNativeState) + send Button.
  TypingIndicator.tsx  native Host Text island (rewrite of existing RN version).
  MessageItem.tsx RN bubble — KEPT, rethemed to tokens. Not nativized (strategy B).
app/(auth)/
  login.tsx       Host + Column form, TextInput x2 via useNativeState, Button.
  register.tsx    Host + Column form, TextInput x3 via useNativeState, Button.
app/(chat)/
  index.tsx       vertical layout: <ChatHeader> / FlashList / <TypingIndicator> / <Composer>, inside KeyboardAvoidingView.
```

**Isolation rule:** screens and components import from `src/ui`, never from `@expo/ui`
directly. If a surface janks or hits an alpha bug, its wrapper falls back to RN without
touching screen code.

## Component specs

### Theme — `src/ui/theme.ts`
Exported `theme` object:
`accent`, `bg`, `surface`, `textPrimary`, `textSecondary`,
`status: { connected, connecting, offline }`, `radius: { sm, md, lg, pill }`.
Single source of truth for native `tint`/`color` props and RN bubble styles.

### Auth — `login.tsx`, `register.tsx`
- One `<Host>` wrapping a `Column` (centered, padded).
- Title `Text`; `TextInput` for email + password (+ confirm on register), each bound to a
  `useNativeState` value. Email: no autocapitalize, email keyboard. Password: secure.
- Primary `Button`: disabled while `loading`, label swaps to a busy state.
- Secondary link `Button` navigating to the other auth screen (`expo-router`).
- Submit handler reads the `useNativeState` values, calls `authStore.login/register`,
  surfaces failures via RN `Alert.alert`.

### Chat header — `ChatHeader.tsx`
Native Host `Row`: `# general` `Text` (bold), a status dot `Icon` colored by
`wsStatus` → `theme.status.*`, `{onlineCount} online` `Text` (secondary), logout
`Button`. Props: `wsStatus`, `onlineCount`, `onLogout`.

### Typing indicator — `TypingIndicator.tsx`
Native Host `Text` island, italic/secondary, same label logic as today
(`"X is typing…"` / `"X, Y are typing…"`). Returns `null` when empty. Fixed min height
to avoid layout jump.

### Composer — `Composer.tsx`
Native Host `Row`: `TextInput` (multiline, bound to `useNativeState` draft) + send
`Button`.
- `onChangeText`: set native state; **throttled 300ms** → `sendTyping(len > 0)` and
  update a send-enabled flag.
- `onSend`: read native draft → `onSend(content)` → reset native state → `sendTyping(false)`.
- Props: `onSend(content: string)`, `sendTyping(active: boolean)`.
- Rationale: keystrokes stay on the native thread (smooth); JS only receives throttled
  presence updates, not per-keystroke bridge traffic.

### Chat screen — `app/(chat)/index.tsx`
`KeyboardAvoidingView` → vertical `View`:
`<ChatHeader>` / `FlashList` (unchanged data path + `scrollToEnd`) / `<TypingIndicator>`
/ `<Composer>`. Wires store/hook values into the new island components.

## Error handling
- Auth failures: `Alert.alert` (cross-platform, already in use).
- Empty/whitespace messages: send button disabled, `onSend` guards on trimmed content.
- `@expo/ui` runtime/render issues: contained per-wrapper in `src/ui` → fall back to RN.

## Testing / verification
- No new jest infra: native `<Host>` views are not unit-testable. Business logic already
  lives in hooks/stores and stays covered there.
- Manual verification via argent on **both** platforms (iOS sim + Android emu):
  `login → chat → send message → typing indicator → logout`, screenshot each step.

## Out of scope (YAGNI)
Native message `List` (strategy A, rejected for recycling/perf), animations, dark-mode
toggle (tokens make it trivial later), avatars/images, message reactions.
