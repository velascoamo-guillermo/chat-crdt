import { memo, useCallback, useEffect, useRef, useState } from "react";
import {
  Row,
  Button,
  Icon,
  AppTextInput,
  SpanText,
  useNativeState,
  circleButton,
  glassChip,
  accessibleLabel,
  useChatTheme,
  ComposerSurface,
} from "../ui";
import ArrowUp from "@expo/material-symbols/arrow_upward.xml";
import Lock from "@expo/material-symbols/lock.xml";
import {
  composerMode,
  e2eeChipLabel,
  sendButtonState,
  sendButtonVisual,
  type SendButtonVisual,
} from "../chat/composerState";
import { applyDraftRestore } from "../utils/draftRestore";

// SF Symbol (iOS) → Material Symbol (Android); a bare SF name renders nothing on Android.
const ICONS: Record<SendButtonVisual["icon"], { ios: SendButtonVisual["icon"]; android: number }> = {
  "arrow.up": { ios: "arrow.up", android: ArrowUp },
  "lock.fill": { ios: "lock.fill", android: Lock },
};

interface Props {
  onSend: (content: string) => void;
  sendTyping: (active: boolean) => void;
  /** ADR-010 send gate (code review round 1, Critical #1/#3): when false,
   * sending is blocked and the draft is preserved rather than cleared —
   * used while the room is E2EE-enabled but this device hasn't loaded the
   * current epoch's key yet. */
  disabled?: boolean;
  /** Room has E2EE enabled — shows the display-only `🔒 Encrypted` chip in the card. */
  encrypted?: boolean;
  /** T10: text the server refused (plaintext into an E2EE room) to put back
   * in the draft. Applied once per `seq`, appended to anything already typed. */
  restoreDraft?: { text: string; seq: number };
}

const TYPING_THROTTLE_MS = 300;
const CIRCLE = 36;

export const Composer = memo(function Composer({
  onSend,
  sendTyping,
  disabled = false,
  encrypted = false,
  restoreDraft,
}: Props) {
  // Text lives in native state — keystrokes don't round-trip through JS or
  // re-render React. `draft.value` is read on demand when sending.
  const draft = useNativeState("");
  const lastTypingAt = useRef(0);
  const lastActive = useRef(false);
  const chat = useChatTheme();
  // Only these two booleans live in React state: they flip on empty↔non-empty
  // and on focus changes, so typing itself never re-renders the composer.
  const [hasText, setHasText] = useState(false);
  // Mirrors hasText so handleChange only calls setHasText on an actual flip.
  const hasTextRef = useRef(false);
  const [focused, setFocused] = useState(false);
  const restoredSeq = useRef<number | null>(null);

  useEffect(() => {
    const seq = applyDraftRestore(
      {
        getDraft: () => draft.value,
        setDraft: (value) => {
          draft.value = value;
        },
        hasText: () => hasTextRef.current,
        setHasText: (active) => {
          hasTextRef.current = active;
          setHasText(active);
        },
      },
      restoreDraft,
      restoredSeq.current,
    );
    if (seq !== null) restoredSeq.current = seq;
  }, [restoreDraft, draft]);

  const handleChange = useCallback(
    (text: string) => {
      const active = text.trim().length > 0;
      if (active !== hasTextRef.current) {
        hasTextRef.current = active;
        setHasText(active);
      }
      const now = Date.now();
      // Emit presence on active->inactive transitions, otherwise throttle.
      if (
        active !== lastActive.current ||
        now - lastTypingAt.current > TYPING_THROTTLE_MS
      ) {
        lastActive.current = active;
        lastTypingAt.current = now;
        sendTyping(active);
      }
    },
    [sendTyping],
  );

  const handleSend = useCallback(() => {
    if (disabled) return;
    const content = draft.value.trim();
    if (!content) return;
    try {
      onSend(content);
    } catch {
      // Blocked send (e.g. a stale-epoch/no-key throw the gate above didn't
      // catch in time — code review round 1, Critical #3): the caller is
      // responsible for surfacing an error state; preserve the draft rather
      // than silently discarding what the user typed.
      return;
    }
    draft.value = "";
    hasTextRef.current = false;
    setHasText(false);
    lastActive.current = false;
    sendTyping(false);
  }, [disabled, draft, onSend, sendTyping]);

  const send = sendButtonVisual(sendButtonState({ hasText, gated: disabled }), chat);
  const mode = composerMode({ focused, hasDraft: hasText });
  const chipLabel = e2eeChipLabel(encrypted);

  return (
    <ComposerSurface
      expanded={mode === "card"}
      surface={chat.surface}
      border={chat.border}
      field={
        <AppTextInput
          value={draft}
          onChangeText={handleChange}
          onFocusChange={setFocused}
          // Multiline: Return inserts a newline, only the Send button sends.
          // No onSubmitEditing / returnKeyType: a submit label or onSubmit makes
          // SwiftUI treat Return as submit (resigning focus) instead of a newline.
          placeholder="Message…"
          placeholderColor={chat.placeholder}
          color={chat.textPrimary}
          accentColor={chat.accent}
          multiline
          maxLines={6}
          grow
          bare
        />
      }
      send={
        // Muted when empty, accent with text, lock when gated.
        <Button
          variant="text"
          onPress={handleSend}
          disabled={!send.enabled}
          modifiers={[...circleButton(CIRCLE, send.tint), ...accessibleLabel(send.a11yLabel)]}
        >
          <Icon
            name={ICONS[send.icon]}
            size={18}
            color={send.enabled ? chat.accentOn : chat.textSecondary}
            accessibilityLabel={send.a11yLabel}
          />
        </Button>
      }
      chip={
        chipLabel ? (
          // Display-only; one screen-reader stop.
          <Row alignment="center" modifiers={glassChip(chat.glassFallback)}>
            <SpanText
              accessibilityLabel={chipLabel}
              spans={[
                { text: "🔒 ", color: chat.textSecondary, size: 12 },
                { text: chipLabel, color: chat.textSecondary, size: 13 },
              ]}
            />
          </Row>
        ) : null
      }
    />
  );
});
