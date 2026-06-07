import { useCallback, useRef } from 'react';
import { View, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { FlashList, type FlashListRef } from '@shopify/flash-list';
import type { MessageDto } from '@chat-crdt/shared';
import { useChatStore } from '../../src/store/chat.store';
import { useSync } from '../../src/hooks/useSync';
import { MessageItem } from '../../src/components/MessageItem';
import { useAuthStore } from '../../src/store/auth.store';
import { usePresence } from '../../src/hooks/usePresence';
import { TypingIndicator } from '../../src/components/TypingIndicator';
import { ChatHeader } from '../../src/components/ChatHeader';
import { Composer } from '../../src/components/Composer';
import { theme } from '../../src/ui';

export default function ChatScreen() {
  const messages = useChatStore(s => s.messages);
  const wsStatus = useChatStore(s => s.wsStatus);
  const { sendMessage, sendTyping, getAwareness } = useSync();
  const { typingUsers, onlineCount } = usePresence(getAwareness());
  const logout = useAuthStore(s => s.logout);
  const listRef = useRef<FlashListRef<MessageDto>>(null);

  const handleSend = useCallback(
    (content: string) => {
      sendMessage(content);
    },
    [sendMessage]
  );

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
      <ChatHeader wsStatus={wsStatus} onlineCount={onlineCount} onLogout={logout} />

      <View style={styles.list}>
        <FlashList
          ref={listRef}
          data={messages}
          renderItem={({ item }) => <MessageItem message={item} />}
          keyExtractor={(item) => item.id}
          onContentSizeChange={() =>
            listRef.current?.scrollToEnd({ animated: false })
          }
          contentContainerStyle={styles.listContent}
        />
      </View>

      <TypingIndicator typingUsers={typingUsers} />
      <Composer onSend={handleSend} sendTyping={sendTyping} />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg },
  list: { flex: 1 },
  listContent: { paddingVertical: 8 },
});
