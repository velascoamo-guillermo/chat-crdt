# Dependency & Config Hygiene Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `@expo/ui` an explicit mobile dependency and collapse the workspace onto a single TypeScript version.

**Architecture:** Two independent config fixes. Audit 2026-06-12 #1 (`@expo/ui` resolves only via expo-router hoisting — fragile for a beta API) and #5 (root/packages on `typescript ^5.8.0`, mobile on `~6.0.3` — two compiler majors in one workspace). Both are verified by typecheck/install, not unit tests.

**Tech Stack:** bun workspaces, TypeScript, Expo SDK 56.

---

### Task 1: Make `@expo/ui` an explicit mobile dependency

**Files:**
- Modify: `apps/mobile/package.json` (dependencies block)

- [ ] **Step 1: Confirm the phantom — `@expo/ui` is imported but not declared**

Run: `grep -rn "@expo/ui" apps/mobile/src && grep '"@expo/ui"' apps/mobile/package.json`
Expected: imports in `src/ui/index.ts` and `src/ui/modifiers.ts`; **no match** in package.json (confirms the phantom).

- [ ] **Step 2: Confirm the version expo-router currently resolves**

Run: `grep '"@expo/ui"' bun.lock | head -1`
Expected: `"@expo/ui": ["@expo/ui@56.0.16", ...]` — pin to this minor.

- [ ] **Step 3: Add the explicit dependency**

In `apps/mobile/package.json`, add to `dependencies` (alphabetical, before `@expo/metro-runtime`):

```json
    "@expo/ui": "~56.0.16",
```

- [ ] **Step 4: Reinstall and verify resolution is now direct**

Run: `bun install && ls node_modules/@expo/ui/package.json`
Expected: install succeeds; file exists. `@expo/ui` is now a declared dependency, not a hoisting accident.

- [ ] **Step 5: Verify mobile still typechecks against the pinned version**

Run: `cd apps/mobile && bunx tsc --noEmit`
Expected: PASS (no new errors from the `@expo/ui` import surface used in `src/ui`).

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/package.json bun.lock
git commit -m "fix(mobile): declare @expo/ui as explicit dependency

Resolved only via expo-router hoisting before this — fragile for a beta
API whose version could shift under an expo-router patch. Audit 2026-06-12 #1."
```

---

### Task 2: Collapse the workspace onto one TypeScript version

**Files:**
- Modify: `package.json` (root devDependencies — keep)
- Modify: `apps/mobile/package.json` (remove per-package pin)
- Modify: `apps/server/package.json` (remove per-package pin)
- Modify: `packages/shared/package.json` (remove per-package pin)
- Modify: `packages/sync-engine/package.json` (remove per-package pin)

**Decision:** single `typescript` devDependency at the workspace root, removed from every package. Pin `^5.8.0` — three of four packages already use it and the toolchain that is hardest to move (ts-jest 29, NestJS decorators) is validated on TS 5.x, while TS 6 support there is unproven. The mobile typecheck in Step 4 is the guard: if Expo 56 strictly requires TS 6, it fails there and we revisit by bumping the single root pin instead of re-splitting.

- [ ] **Step 1: Confirm current skew**

Run: `grep -r '"typescript"' package.json apps/*/package.json packages/*/package.json`
Expected: root/server/shared/sync-engine `^5.8.0`; mobile `~6.0.3`.

- [ ] **Step 2: Pin the root version**

In `package.json` (root) `devDependencies`, ensure exactly:

```json
    "typescript": "^5.8.0"
```

- [ ] **Step 3: Remove the per-package pins**

Delete the `"typescript": ...` line from the `devDependencies` of each: `apps/mobile/package.json`, `apps/server/package.json`, `packages/shared/package.json`, `packages/sync-engine/package.json`. Leave the root pin as the single source.

- [ ] **Step 4: Reinstall and verify one resolved version**

Run: `bun install && bun pm ls --all 2>/dev/null | grep -i "typescript@" | sort -u`
Expected: a single `typescript@5.8.x` entry across the workspace.

- [ ] **Step 5: Typecheck every workspace against the single version**

Run:
```bash
cd apps/server && bunx tsc --noEmit && cd ../..
cd apps/mobile && bunx tsc --noEmit && cd ../..
cd packages/shared && bunx tsc --noEmit && cd ../..
cd packages/sync-engine && bunx tsc --noEmit && cd ../..
```
Expected: all PASS. If mobile FAILS with TS-version errors, Expo 56 needs TS 6 — bump the root pin to `~6.0.3` and re-run (single-source bump, no re-split).

- [ ] **Step 6: Run the existing test suites unchanged**

Run: `cd apps/server && bun run test && cd ../../packages/sync-engine && bun test`
Expected: existing suites still green (ts-jest + bun test both on the single TS version).

- [ ] **Step 7: Commit**

```bash
git add package.json apps/mobile/package.json apps/server/package.json packages/shared/package.json packages/sync-engine/package.json bun.lock
git commit -m "chore: single TypeScript version across the workspace

Root-only typescript devDependency; removed per-package pins. Eliminates
the ^5.8 vs ~6.0 major skew. Audit 2026-06-12 #5."
```
