import { memo } from 'react';
import { View, Text, StyleSheet } from 'react-native';

interface Props {
  typingUsers: string[];
}

export const TypingIndicator = memo(function TypingIndicator({ typingUsers }: Props) {
  if (typingUsers.length === 0) return null;

  const label =
    typingUsers.length === 1
      ? `${typingUsers[0]} is typing...`
      : `${typingUsers.slice(0, 2).join(', ')} are typing...`;

  return (
    <View style={styles.container}>
      <Text style={styles.text}>{label}</Text>
    </View>
  );
});

const styles = StyleSheet.create({
  container: { paddingHorizontal: 16, paddingVertical: 4, minHeight: 22 },
  text: { fontSize: 12, color: '#888', fontStyle: 'italic' },
});
