import { memo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { MessageDto } from '@chat-crdt/shared';
import { useAuthStore } from '../store/auth.store';
import { darkTheme as theme } from '../ui';

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
