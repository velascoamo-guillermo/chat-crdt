import { memo, useCallback, useRef, useState } from "react";
import {
  Host,
  Row,
  Button,
  Icon,
  AppTextInput,
  useNativeState,
  circleButton,
  accessibleLabel,
  useUITheme,
  useChatTheme,
} from "../ui";
import { isLiquidGlassAvailable } from "expo-glass-effect";
import ArrowUp from "@expo/material-symbols/arrow_upward.xml";
import Lock from "@expo/material-symbols/lock.xml";
import { sendButtonState, sendButtonVisual, type SendButtonVisual } from "../chat/composerState";

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
}

const TYPING_THROTTLE_MS = 300;
const CIRCLE = 40;

export const Composer = memo(function Composer({ onSend, sendTyping, disabled = false }: Props) {
  // Text lives in native state — keystrokes don't round-trip through JS or
  // re-render React. `draft.value` is read on demand when sending.
  const draft = useNativeState("");
  const lastTypingAt = useRef(0);
  const lastActive = useRef(false);
  const t = useUITheme();
  const chat = useChatTheme();
  // Only these two booleans live in React state: they flip on empty↔non-empty
  // and on focus changes, so typing itself never re-renders the composer.
  const [hasText, setHasText] = useState(false);
  // Consumed by the pill↔card morph (T7).
  const [, setFocused] = useState(false);

  const handleChange = useCallback(
    (text: string) => {
      const active = text.trim().length > 0;
      setHasText(active); // bail-out: same value → no re-render
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
    setHasText(false);
    lastActive.current = false;
    sendTyping(false);
  }, [disabled, draft, onSend, sendTyping]);

  const send = sendButtonVisual(sendButtonState({ hasText, gated: disabled }), chat);

  return (
    <Host
      matchContents={{ vertical: true }}
      style={{
        backgroundColor: !isLiquidGlassAvailable() ? t.surface : "transparent",
      }}
    >
      <Row spacing={12} alignment="center" style={{ padding: 12 }}>
        <AppTextInput
          value={draft}
          onChangeText={handleChange}
          onFocusChange={setFocused}
          onSubmitEditing={handleSend}
          placeholder="Message…"
          returnKeyType="send"
          multiline
          grow
        />

        {/* Send circle: muted when empty, accent with text, lock when gated. */}
        <Button
          variant="text"
          onPress={handleSend}
          disabled={!send.enabled}
          modifiers={[...circleButton(CIRCLE, send.tint), ...accessibleLabel(send.a11yLabel)]}
        >
          <Icon
            name={ICONS[send.icon]}
            size={20}
            color={send.enabled ? chat.accentOn : chat.textSecondary}
            accessibilityLabel={send.a11yLabel}
          />
        </Button>
      </Row>
    </Host>
  );
});
