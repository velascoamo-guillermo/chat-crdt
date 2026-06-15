import { memo, useCallback, useRef } from "react";
import {
  Host,
  Row,
  Button,
  Icon,
  AppTextInput,
  useNativeState,
  circleButton,
  useUITheme,
} from "../ui";
import { isLiquidGlassAvailable } from "expo-glass-effect";

interface Props {
  onSend: (content: string) => void;
  sendTyping: (active: boolean) => void;
}

const TYPING_THROTTLE_MS = 300;
const CIRCLE = 40;

export const Composer = memo(function Composer({ onSend, sendTyping }: Props) {
  // Text lives in native state — keystrokes don't round-trip through JS or
  // re-render React. `draft.value` is read on demand when sending.
  const draft = useNativeState("");
  const lastTypingAt = useRef(0);
  const lastActive = useRef(false);
  const t = useUITheme();

  const handleChange = useCallback(
    (text: string) => {
      const active = text.trim().length > 0;
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
    const content = draft.value.trim();
    if (!content) return;
    onSend(content);
    draft.value = "";
    lastActive.current = false;
    sendTyping(false);
  }, [draft, onSend, sendTyping]);

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
          onSubmitEditing={handleSend}
          placeholder="Message…"
          returnKeyType="send"
          multiline
          grow
        />

        {/* Accent-tinted glass circle for send affordance. */}
        <Button
          variant="text"
          onPress={handleSend}
          modifiers={circleButton(CIRCLE, t.accent)}
        >
          <Icon name="arrow.up" size={20} />
        </Button>
      </Row>
    </Host>
  );
});
