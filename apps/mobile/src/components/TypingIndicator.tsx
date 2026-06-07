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
