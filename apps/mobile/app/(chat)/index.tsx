import { useState, useCallback, useRef } from 'react';
import {
  View,
  TextInput,
  TouchableOpacity,
  Text,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import type { MessageDto } from '@chat-crdt/shared';
import { useChatStore } from '../../src/store/chat.store';
import { useSync } from '../../src/hooks/useSync';
import { MessageItem } from '../../src/components/MessageItem';
import { useAuthStore } from '../../src/store/auth.store';

export default function ChatScreen() {
  const [input, setInput] = useState('');
  const messages = useChatStore(s => s.messages);
  const wsStatus = useChatStore(s => s.wsStatus);
  const { sendMessage, sendTyping } = useSync();
  const logout = useAuthStore(s => s.logout);
  const listRef = useRef<FlashList<MessageDto>>(null);

  const handleSend = useCallback(() => {
    const content = input.trim();
    if (!content) return;
    sendMessage(content);
    setInput('');
    sendTyping(false);
  }, [input, sendMessage, sendTyping]);

  const handleChangeText = useCallback((text: string) => {
    setInput(text);
    sendTyping(text.length > 0);
  }, [sendTyping]);

  const statusColor =
    wsStatus === 'connected'
      ? '#22c55e'
      : wsStatus === 'connecting'
      ? '#f59e0b'
      : '#ef4444';

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
      <View style={styles.header}>
        <Text style={styles.roomName}># general</Text>
        <View style={styles.headerRight}>
          <View style={[styles.dot, { backgroundColor: statusColor }]} />
          <TouchableOpacity onPress={logout}>
            <Text style={styles.logoutText}>Logout</Text>
          </TouchableOpacity>
        </View>
      </View>

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

      <View style={styles.inputRow}>
        <TextInput
          style={styles.textInput}
          value={input}
          onChangeText={handleChangeText}
          placeholder="Message..."
          placeholderTextColor="#aaa"
          multiline
          returnKeyType="send"
          blurOnSubmit={false}
          onSubmitEditing={handleSend}
        />
        <TouchableOpacity
          style={[styles.sendButton, !input.trim() && styles.sendButtonDisabled]}
          onPress={handleSend}
          disabled={!input.trim()}
        >
          <Text style={styles.sendText}>Send</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    paddingTop: 56,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  roomName: { fontSize: 18, fontWeight: '700' },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  logoutText: { color: '#888', fontSize: 14 },
  listContent: { paddingVertical: 8 },
  inputRow: {
    flexDirection: 'row',
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: '#eee',
    alignItems: 'flex-end',
    gap: 8,
  },
  textInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 15,
    maxHeight: 120,
    color: '#111',
  },
  sendButton: {
    backgroundColor: '#0066ff',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  sendButtonDisabled: { backgroundColor: '#c0c0c0' },
  sendText: { color: '#fff', fontWeight: '600' },
});
