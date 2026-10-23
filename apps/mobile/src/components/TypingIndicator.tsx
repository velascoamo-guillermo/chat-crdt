import { memo } from 'react';
import { ThinkingRow, useChatTheme } from '../ui';
import { typingLabel } from '../chat/conversationCopy';

interface Props {
  typingUsers: string[];
}

// Display-only: who is typing comes from awareness (usePresence); sendTyping
// throttling lives in Composer.
export const TypingIndicator = memo(function TypingIndicator({ typingUsers }: Props) {
  const t = useChatTheme();
  return (
    <ThinkingRow
      label={typingLabel(typingUsers)}
      color={t.textSecondary}
      fill={t.surface}
      radius={t.radius.bubble}
    />
  );
});
