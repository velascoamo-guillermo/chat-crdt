# @expo/ui Native UI Pass — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the mobile app's plain RN `StyleSheet` UI with `@expo/ui` native components (SwiftUI/Jetpack Compose), driving text inputs with `useNativeState`, while keeping `FlashList` + RN bubbles for the message feed (strategy B).

**Architecture:** A `src/ui` wrapper layer is the only module importing `@expo/ui`; screens import from it. Native `<Host>` islands sit at the top (header) and bottom (typing + composer) of a vertical RN layout, with `FlashList` (unchanged Yjs data path) in the middle. Auth screens become native `Column` forms. Stores/hooks are untouched.

**Tech Stack:** Expo SDK 56, `@expo/ui` 56.0.16 (`@expo/ui/universal`), React Native 0.76, expo-router, zustand, Yjs sync engine.

---

## Verification strategy (read first)

Per the approved spec, **no jest infra is added**: `@expo/ui` `<Host>` views are native islands not renderable in jest, and all business logic already lives in untouched hooks/stores. Each task's fast feedback loop is:

- **Type check:** `cd apps/mobile && bunx tsc --noEmit` → Expected: no errors.
- **Visual verification (integration tasks 6 & 9):** argent on iOS sim **and** Android emu.

Commit after every task.

## File structure

```
apps/mobile/
  src/ui/
    theme.ts        NEW  design tokens
    modifiers.ts    NEW  grow() platform modifier helper
    index.ts        NEW  barrel: re-exports @expo/ui/universal primitives + theme + grow
  src/components/
    MessageItem.tsx      MODIFY  retheme to tokens (stays RN)
    TypingIndicator.tsx  REWRITE native Host Text island
    ChatHeader.tsx       NEW  native header island
    Composer.tsx         NEW  native composer island (useNativeState)
  app/(auth)/login.tsx     REWRITE native Column form
  app/(auth)/register.tsx  REWRITE native Column form
  app/(chat)/index.tsx     MODIFY  compose header / FlashList / typing / composer
```

---

### Task 1: UI wrapper layer (theme + modifiers + barrel)

**Files:**
- Create: `apps/mobile/src/ui/theme.ts`
- Create: `apps/mobile/src/ui/modifiers.ts`
- Create: `apps/mobile/src/ui/index.ts`

- [ ] **Step 1: Write `theme.ts`**

```ts
export const theme = {
  accent: '#0066ff',
  bg: '#ffffff',
  surface: '#f0f0f0',
  textPrimary: '#111111',
  textSecondary: '#888888',
  placeholder: '#aaaaaa',
  border: '#eeeeee',
  bubbleOther: '#f0f0f0',
  status: {
    connected: '#22c55e',
    connecting: '#f59e0b',
    offline: '#ef4444',
  },
  radius: { sm: 4, md: 8, lg: 16, pill: 20 },
} as const;

export type Theme = typeof theme;

// Maps any ws status string to a dot color.
export function statusColor(status: string): string {
  if (status === 'connected') return theme.status.connected;
  if (status === 'connecting') return theme.status.connecting;
  return theme.status.offline;
}
```

- [ ] **Step 2: Write `modifiers.ts`**

`UniversalStyle` has no `flex`. To make a `Row`/`Column` child fill the main axis, apply a platform modifier: iOS `frame({ maxWidth: Infinity })`, Android `weight(1)`.

```ts
import { Platform } from 'react-native';
import { frame } from '@expo/ui/swift-ui/modifiers';
import { weight } from '@expo/ui/jetpack-compose/modifiers';

// Make a Row/Column child expand to fill available main-axis space.
export function grow() {
  return Platform.OS === 'android' ? [weight(1)] : [frame({ maxWidth: Infinity })];
}
```

- [ ] **Step 3: Write `index.ts` barrel**

```ts
export {
  Host,
  Row,
  Column,
  Text,
  Button,
  TextInput,
  Icon,
  Spacer,
  useNativeState,
  type ObservableState,
} from '@expo/ui/universal';
export { theme, statusColor, type Theme } from './theme';
export { grow } from './modifiers';
```

- [ ] **Step 4: Type check**

Run: `cd apps/mobile && bunx tsc --noEmit`
Expected: no errors. If `@expo/ui/universal`, `@expo/ui/swift-ui/modifiers`, or `@expo/ui/jetpack-compose/modifiers` fails to resolve, confirm the subpath in `node_modules/@expo/ui/package.json` `exports` and adjust the import path accordingly.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/ui
git commit -m "feat(mobile): add @expo/ui wrapper layer with theme + grow modifier"
```

---

### Task 2: Retheme MessageItem (keep RN)

**Files:**
- Modify: `apps/mobile/src/components/MessageItem.tsx`

- [ ] **Step 1: Replace hardcoded colors with tokens**

Keep the component RN (strategy B). Import the theme and swap literals. Full new `StyleSheet` block:

```tsx
import { memo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { MessageDto } from '@chat-crdt/shared';
import { useAuthStore } from '../store/auth.store';
import { theme } from '../ui';

interface Props {
  message: MessageDto;
}

export const MessageItem = memo(function MessageItem({ message }: Props) {
  const myUserId = useAuthStore(s => s.user?.id);
  const isOwn = message.userId === myUserId;

  return (
    <View style={[styles.row, isOwn && styles.rowOwn]}>
      {!isOwn && <Text style={styles.username}>{message.username}</Text>}
      <View style={[styles.bubble, isOwn ? styles.bubbleOwn : styles.bubbleOther]}>
        <Text style={[styles.content, isOwn && styles.contentOwn]}>
          {message.content}
        </Text>
      </View>
      <Text style={styles.time}>
        {new Date(message.createdAt).toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
        })}
      </Text>
    </View>
  );
});

const styles = StyleSheet.create({
  row: { marginVertical: 4, marginHorizontal: 12, alignItems: 'flex-start' },
  rowOwn: { alignItems: 'flex-end' },
  username: { fontSize: 11, color: theme.textSecondary, marginBottom: 2, marginLeft: 4 },
  bubble: {
    maxWidth: '75%',
    borderRadius: theme.radius.lg,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  bubbleOwn: { backgroundColor: theme.accent, borderBottomRightRadius: theme.radius.sm },
  bubbleOther: { backgroundColor: theme.bubbleOther, borderBottomLeftRadius: theme.radius.sm },
  content: { fontSize: 15, color: theme.textPrimary },
  contentOwn: { color: '#fff' },
  time: { fontSize: 10, color: theme.placeholder, marginTop: 2, marginHorizontal: 4 },
});
```

- [ ] **Step 2: Type check**

Run: `cd apps/mobile && bunx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/src/components/MessageItem.tsx
git commit -m "refactor(mobile): retheme MessageItem to design tokens"
```

---

### Task 3: TypingIndicator as native island

**Files:**
- Modify (rewrite): `apps/mobile/src/components/TypingIndicator.tsx`

- [ ] **Step 1: Rewrite using Host + Text**

```tsx
import { memo } from 'react';
import { Host, Text, theme } from '../ui';

interface Props {
  typingUsers: string[];
}

export const TypingIndicator = memo(function TypingIndicator({ typingUsers }: Props) {
  if (typingUsers.length === 0) return null;

  const label =
    typingUsers.length === 1
      ? `${typingUsers[0]} is typing…`
      : `${typingUsers.slice(0, 2).join(', ')} are typing…`;

  return (
    <Host matchContents={{ vertical: true }} style={{ backgroundColor: theme.bg }}>
      <Text
        textStyle={{ fontSize: 12, color: theme.textSecondary }}
        style={{ paddingHorizontal: 16, paddingVertical: 4 }}
      >
        {label}
      </Text>
    </Host>
  );
});
```

Note: `UniversalTextStyle` has no `fontStyle`, so the previous italic is dropped (color/secondary conveys the hint). `matchContents={{ vertical: true }}` fills width, wraps height so the island doesn't claim the screen.

- [ ] **Step 2: Type check**

Run: `cd apps/mobile && bunx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/src/components/TypingIndicator.tsx
git commit -m "feat(mobile): native TypingIndicator island via @expo/ui"
```

---

### Task 4: ChatHeader native island

**Files:**
- Create: `apps/mobile/src/components/ChatHeader.tsx`

- [ ] **Step 1: Write ChatHeader**

```tsx
import { memo } from 'react';
import { Host, Row, Text, Button, Spacer, theme, statusColor } from '../ui';

interface Props {
  wsStatus: string;
  onlineCount: number;
  onLogout: () => void;
}

export const ChatHeader = memo(function ChatHeader({ wsStatus, onlineCount, onLogout }: Props) {
  return (
    <Host matchContents={{ vertical: true }} style={{ backgroundColor: theme.bg }}>
      <Row
        alignment="center"
        spacing={8}
        style={{ paddingTop: 56, paddingBottom: 16, paddingHorizontal: 16 }}
      >
        <Text textStyle={{ fontSize: 18, fontWeight: '700', color: theme.textPrimary }}>
          # general
        </Text>
        <Spacer />
        <Text textStyle={{ fontSize: 14, color: statusColor(wsStatus) }}>●</Text>
        <Text textStyle={{ fontSize: 12, color: theme.textSecondary }}>
          {`${onlineCount} online`}
        </Text>
        <Button variant="text" label="Logout" onPress={onLogout} />
      </Row>
    </Host>
  );
});
```

The status dot is a colored `●` glyph `Text` (cross-platform; avoids per-platform `Icon` image assets).

- [ ] **Step 2: Type check**

Run: `cd apps/mobile && bunx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/src/components/ChatHeader.tsx
git commit -m "feat(mobile): native ChatHeader island via @expo/ui"
```

---

### Task 5: Composer native island (useNativeState)

**Files:**
- Create: `apps/mobile/src/components/Composer.tsx`

- [ ] **Step 1: Write Composer**

```tsx
import { memo, useCallback, useRef } from 'react';
import { Host, Row, Button, TextInput, useNativeState, grow, theme } from '../ui';

interface Props {
  onSend: (content: string) => void;
  sendTyping: (active: boolean) => void;
}

const TYPING_THROTTLE_MS = 300;

export const Composer = memo(function Composer({ onSend, sendTyping }: Props) {
  const draft = useNativeState('');
  const lastTypingAt = useRef(0);
  const lastActive = useRef(false);

  const handleChange = useCallback(
    (text: string) => {
      draft.value = text;
      const active = text.trim().length > 0;
      const now = Date.now();
      // Emit presence on active->inactive transitions, otherwise throttle.
      if (active !== lastActive.current || now - lastTypingAt.current > TYPING_THROTTLE_MS) {
        lastActive.current = active;
        lastTypingAt.current = now;
        sendTyping(active);
      }
    },
    [draft, sendTyping]
  );

  const handleSend = useCallback(() => {
    const content = draft.value.trim();
    if (!content) return;
    onSend(content);
    draft.value = '';
    lastActive.current = false;
    sendTyping(false);
  }, [draft, onSend, sendTyping]);

  return (
    <Host matchContents={{ vertical: true }} style={{ backgroundColor: theme.bg }}>
      <Row alignment="center" spacing={8} style={{ padding: 12 }}>
        <TextInput
          value={draft}
          onChangeText={handleChange}
          onSubmitEditing={handleSend}
          placeholder="Message…"
          placeholderTextColor={theme.placeholder}
          returnKeyType="send"
          multiline
          modifiers={grow()}
          textStyle={{ fontSize: 15, color: theme.textPrimary }}
        />
        <Button
          variant="filled"
          label="Send"
          onPress={handleSend}
          style={{ backgroundColor: theme.accent, borderRadius: theme.radius.pill }}
        />
      </Row>
    </Host>
  );
});
```

`value={draft}` binds the `ObservableState` directly (the universal `TextInput` API). `modifiers={grow()}` makes the input fill the row. Keystrokes render on the native thread; JS receives only throttled `sendTyping` calls.

- [ ] **Step 2: Type check**

Run: `cd apps/mobile && bunx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/src/components/Composer.tsx
git commit -m "feat(mobile): native Composer island with useNativeState"
```

---

### Task 6: Wire chat screen + verify on device

**Files:**
- Modify: `apps/mobile/app/(chat)/index.tsx`

- [ ] **Step 1: Rewrite the screen body to use the islands**

```tsx
import { useCallback, useRef } from 'react';
import { View, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import type { MessageDto } from '@chat-crdt/shared';
import { useChatStore } from '../../src/store/chat.store';
import { useSync } from '../../src/hooks/useSync';
import { MessageItem } from '../../src/components/MessageItem';
import { useAuthStore } from '../../src/store/auth.store';
import { usePresence } from '../../src/hooks/usePresence';
import { TypingIndicator } from '../../src/components/TypingIndicator';
import { ChatHeader } from '../../src/components/ChatHeader';
import { Composer } from '../../src/components/Composer';
import { theme } from '../../src/ui';

export default function ChatScreen() {
  const messages = useChatStore(s => s.messages);
  const wsStatus = useChatStore(s => s.wsStatus);
  const { sendMessage, sendTyping, getAwareness } = useSync();
  const { typingUsers, onlineCount } = usePresence(getAwareness());
  const logout = useAuthStore(s => s.logout);
  const listRef = useRef<FlashList<MessageDto>>(null);

  const handleSend = useCallback(
    (content: string) => {
      sendMessage(content);
    },
    [sendMessage]
  );

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
      <ChatHeader wsStatus={wsStatus} onlineCount={onlineCount} onLogout={logout} />

      <FlashList
        ref={listRef}
        data={messages}
        renderItem={({ item }) => <MessageItem message={item} />}
        keyExtractor={(item) => item.id}
        estimatedItemSize={60}
        onContentSizeChange={() =>
          listRef.current?.scrollToEnd({ animated: false })
        }
        contentContainerStyle={styles.listContent}
      />

      <TypingIndicator typingUsers={typingUsers} />
      <Composer onSend={handleSend} sendTyping={sendTyping} />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg },
  listContent: { paddingVertical: 8 },
});
```

- [ ] **Step 2: Type check**

Run: `cd apps/mobile && bunx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Verify on iOS simulator (argent)**

Boot iOS sim, run the app (`expo run:ios` or dev client), log in, land on chat. Use argent: `screenshot`, then `debugger-component-tree` / `describe` to confirm header, composer, and typing islands render. Type in the composer → confirm text appears and is smooth; send → message appears in `FlashList`; second client (or self) shows typing indicator.
Expected: header dot reflects ws status; composer input fills width next to Send; messages scroll to end.

- [ ] **Step 4: Verify on Android emulator (argent)**

Boot Android emu, run (`expo run:android`), repeat the same checks.
Expected: parity with iOS — native input grows via `weight(1)`, Send button themed.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/app/(chat)/index.tsx
git commit -m "feat(mobile): compose chat screen from native @expo/ui islands"
```

---

### Task 7: Native login screen

**Files:**
- Modify (rewrite): `apps/mobile/app/(auth)/login.tsx`

- [ ] **Step 1: Rewrite with Host + Column form**

```tsx
import { useCallback, useRef, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuthStore } from '../../src/store/auth.store';
import { Host, Column, Text, TextInput, Button, useNativeState, theme } from '../../src/ui';

export default function LoginScreen() {
  const email = useNativeState('');
  const password = useNativeState('');
  const [loading, setLoading] = useState(false);
  const login = useAuthStore(s => s.login);
  const router = useRouter();

  const handleLogin = useCallback(async () => {
    const e = email.value.trim();
    const p = password.value;
    if (!e || !p) {
      Alert.alert('Error', 'Email and password are required');
      return;
    }
    setLoading(true);
    try {
      await login(e, p);
    } catch (err: unknown) {
      Alert.alert('Login failed', err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [email, password, login]);

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <Host matchContents={{ vertical: true }} style={styles.host}>
        <Column spacing={12} style={{ padding: 24 }}>
          <Text textStyle={{ fontSize: 28, fontWeight: '700', color: theme.textPrimary, textAlign: 'center' }}>
            Chat CRDT
          </Text>
          <TextInput
            value={email}
            placeholder="Email"
            placeholderTextColor={theme.placeholder}
            autoCapitalize="none"
            keyboardType="email-address"
            autoComplete="email"
            textStyle={{ fontSize: 16, color: theme.textPrimary }}
          />
          <TextInput
            value={password}
            placeholder="Password"
            placeholderTextColor={theme.placeholder}
            secureTextEntry
            autoComplete="password"
            textStyle={{ fontSize: 16, color: theme.textPrimary }}
          />
          <Button
            variant="filled"
            label={loading ? 'Logging in…' : 'Login'}
            onPress={handleLogin}
            disabled={loading}
            style={{ backgroundColor: theme.accent, borderRadius: theme.radius.md }}
          />
          <Button
            variant="text"
            label="No account? Register"
            onPress={() => router.push('/(auth)/register')}
          />
        </Column>
      </Host>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg, justifyContent: 'center' },
  host: { backgroundColor: theme.bg },
});
```

Note: `Button` exposes `disabled` via `UniversalBaseProps`. If `tsc` reports `disabled` is not assignable, drop the prop and instead guard inside `handleLogin` with an `if (loading) return;` at the top (the loading label already signals state).

- [ ] **Step 2: Type check**

Run: `cd apps/mobile && bunx tsc --noEmit`
Expected: no errors (apply the `disabled` fallback above if flagged).

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/app/(auth)/login.tsx
git commit -m "feat(mobile): native login screen via @expo/ui"
```

---

### Task 8: Native register screen

**Files:**
- Modify (rewrite): `apps/mobile/app/(auth)/register.tsx`

- [ ] **Step 1: Rewrite with Host + Column form**

```tsx
import { useCallback, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuthStore } from '../../src/store/auth.store';
import { Host, Column, Text, TextInput, Button, useNativeState, theme } from '../../src/ui';

export default function RegisterScreen() {
  const email = useNativeState('');
  const username = useNativeState('');
  const password = useNativeState('');
  const [loading, setLoading] = useState(false);
  const register = useAuthStore(s => s.register);
  const router = useRouter();

  const handleRegister = useCallback(async () => {
    const e = email.value.trim();
    const u = username.value.trim();
    const p = password.value;
    if (!e || !u || !p) {
      Alert.alert('Error', 'All fields are required');
      return;
    }
    if (p.length < 8) {
      Alert.alert('Error', 'Password must be at least 8 characters');
      return;
    }
    setLoading(true);
    try {
      await register(e, u, p);
    } catch (err: unknown) {
      Alert.alert('Registration failed', err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [email, username, password, register]);

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <Host matchContents={{ vertical: true }} style={styles.host}>
        <Column spacing={12} style={{ padding: 24 }}>
          <Text textStyle={{ fontSize: 28, fontWeight: '700', color: theme.textPrimary, textAlign: 'center' }}>
            Create Account
          </Text>
          <TextInput
            value={email}
            placeholder="Email"
            placeholderTextColor={theme.placeholder}
            autoCapitalize="none"
            keyboardType="email-address"
            autoComplete="email"
            textStyle={{ fontSize: 16, color: theme.textPrimary }}
          />
          <TextInput
            value={username}
            placeholder="Username"
            placeholderTextColor={theme.placeholder}
            autoCapitalize="none"
            textStyle={{ fontSize: 16, color: theme.textPrimary }}
          />
          <TextInput
            value={password}
            placeholder="Password"
            placeholderTextColor={theme.placeholder}
            secureTextEntry
            autoComplete="password"
            textStyle={{ fontSize: 16, color: theme.textPrimary }}
          />
          <Button
            variant="filled"
            label={loading ? 'Creating…' : 'Register'}
            onPress={handleRegister}
            disabled={loading}
            style={{ backgroundColor: theme.accent, borderRadius: theme.radius.md }}
          />
          <Button
            variant="text"
            label="Have an account? Login"
            onPress={() => router.back()}
          />
        </Column>
      </Host>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg, justifyContent: 'center' },
  host: { backgroundColor: theme.bg },
});
```

Same `disabled` fallback note as Task 7 applies.

- [ ] **Step 2: Type check**

Run: `cd apps/mobile && bunx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/app/(auth)/register.tsx
git commit -m "feat(mobile): native register screen via @expo/ui"
```

---

### Task 9: Full-flow verification, both platforms

**Files:** none (verification only)

- [ ] **Step 1: iOS end-to-end (argent)**

Boot iOS sim, run the app. Flow: register → auto-login → chat → send a message → observe typing indicator → logout → login. Screenshot each screen. Confirm native inputs accept text, buttons themed, no layout collapse (composer input fills width).

- [ ] **Step 2: Android end-to-end (argent)**

Boot Android emu, run the app, repeat the same flow. Confirm parity.

- [ ] **Step 3: Final type check + commit verification doc (optional)**

Run: `cd apps/mobile && bunx tsc --noEmit`
Expected: no errors. No code changes expected here; if a fix was needed, commit it with a `fix(mobile):` message.

---

## Self-review notes

- **Spec coverage:** theme (T1) · UI wrapper isolation (T1) · auth native forms (T7, T8) · header island (T4) · composer + useNativeState + throttled typing (T5) · typing island (T3) · FlashList + RN bubbles retained & rethemed (T2, T6) · both-platform single codebase (universal + grow) · argent verification (T6, T9). All spec sections mapped.
- **Known alpha risks surfaced inline:** `@expo/ui/universal` subpath resolution (T1.4), `Button.disabled` support (T7/T8 fallback), child-fill layout via `grow()` (T5). Each has an explicit fallback.
- **Types consistent:** `useNativeState(initial)` → `{ value }`; `TextInput.value` takes the `ObservableState`; `statusColor(string)` used in T4; `grow()` returns a modifiers array used in T5.
