import { memo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { MessageDto } from '@chat-crdt/shared';
import { useAuthStore } from '../store/auth.store';

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
  username: { fontSize: 11, color: '#888', marginBottom: 2, marginLeft: 4 },
  bubble: {
    maxWidth: '75%',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  bubbleOwn: { backgroundColor: '#0066ff', borderBottomRightRadius: 4 },
  bubbleOther: { backgroundColor: '#f0f0f0', borderBottomLeftRadius: 4 },
  content: { fontSize: 15, color: '#111' },
  contentOwn: { color: '#fff' },
  time: { fontSize: 10, color: '#aaa', marginTop: 2, marginHorizontal: 4 },
});
