# ADR-007: `@expo/ui` native islands for chrome; FlashList stays React Native

**Date:** 2026-06-12
**Status:** Accepted (implemented across the `feat/expo-ui-native-pass` PR)

## Context

Expo SDK 56 ships `@expo/ui` — SwiftUI/Jetpack Compose components hosted inside RN ("islands"). The app's chrome (login, register, chat header, composer, typing indicator) benefits from native fidelity; the message list has hard requirements native islands don't serve: virtualization over unbounded history and direct subscription to the Yjs-backed store.

## Decision

Split by component class:

- **Native islands** for auth screens, `ChatHeader`, `Composer`, `TypingIndicator` — wrapped behind a project-local `src/ui` layer (re-exports + theme + cross-platform modifiers) so screens never import `@expo/ui` directly.
- **FlashList in RN** for the message list — virtualization, `maintainVisibleContentPosition`-style scroll control, and per-item React rendering tied to Zustand/Yjs.

Two load-bearing details: the `src/ui` wrapper is the blast-shield for a beta API (churn lands in one directory, not every screen), and the composer uses `useNativeState` so keystrokes stay native-side — the JS thread sees the text only on submit, instead of a bridge round-trip per keypress.

## Alternatives Considered

- **Full custom RN UI:** rejected — pixel-perfect control, but native text input behavior (autofill, keyboard avoidance, selection) is exactly the area where RN reimplementations stay subtly wrong.
- **Fully native screens:** rejected — loses RN list virtualization and the trivial CRDT-store-to-list data flow; would push sync state across the native boundary.

## Consequences

**Good:** platform-correct inputs, typography, and focus behavior for free; keystrokes off the JS thread; API churn contained in `src/ui`.

**Bad:** `@expo/ui` is beta — breaking changes expected, and per-platform modifiers (`swift-ui` / `jetpack-compose` subpaths) mean some per-platform code. Island/RN layout boundaries have edge cases (the FlashList flex-wrapper fix). Currently `@expo/ui` is a phantom dependency — resolved transitively via expo-router — which must become an explicit dependency (audit 2026-06-12 #1).
