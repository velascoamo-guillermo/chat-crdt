import { memo, useCallback, useRef } from 'react';
import {
  Host,
  Row,
  Button,
  TextInput,
  Icon,
  useNativeState,
  grow,
  pillInput,
  circleButton,
  theme,
} from '../ui';

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
          modifiers={[...grow(), ...pillInput()]}
          textStyle={{ fontSize: 15, color: theme.textPrimary }}
        />
        <Button onPress={handleSend} modifiers={circleButton()}>
          <Icon name="arrow.up" size={18} color="#fff" />
        </Button>
      </Row>
    </Host>
  );
});
