import { useCallback, useState } from "react";
import {
  View,
  StyleSheet,
  type LayoutChangeEvent,
  type ScrollViewProps,
} from "react-native";
import { FlashList } from "@shopify/flash-list";
import { LinearGradient } from "expo-linear-gradient";
import {
  KeyboardGestureArea,
  KeyboardStickyView,
} from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Stack, useRouter } from "expo-router";
import { useChatStore } from "../../src/store/chat.store";
import { useSync } from "../../src/hooks/useSync";
import { MessageItem } from "../../src/components/MessageItem";
import { ChatScrollView } from "../../src/components/ChatScrollView";
import { usePresence } from "../../src/hooks/usePresence";
import { TypingIndicator } from "../../src/components/TypingIndicator";
import { HeaderAccount, OnlinePill } from "../../src/components/ChatHeader";
import { Composer } from "../../src/components/Composer";
import { darkTheme as theme } from "../../src/ui";

const LIST_PADDING = 8;

export default function ChatScreen() {
  const messages = useChatStore((s) => s.messages);
  const wsStatus = useChatStore((s) => s.wsStatus);
  const { sendMessage, sendTyping, getAwareness } = useSync();
  const { typingUsers, onlineCount } = usePresence(getAwareness());
  const router = useRouter();
  const { bottom } = useSafeAreaInsets();

  // The composer overlays the bottom of the list. Reserve its measured height as
  // bottom padding so the newest message is never clipped behind it (at rest);
  // the keyboard lift on top of that is handled by KeyboardChatScrollView.
  const [composerHeight, setComposerHeight] = useState(0);

  const handleComposerLayout = useCallback((e: LayoutChangeEvent) => {
    setComposerHeight(e.nativeEvent.layout.height);
  }, []);

  const renderScrollComponent = useCallback(
    (props: ScrollViewProps) => <ChatScrollView {...props} />,
    [],
  );

  const handleSend = useCallback(
    (content: string) => {
      sendMessage(content);
    },
    [sendMessage],
  );

  return (
    <KeyboardGestureArea interpolator="ios" style={styles.container}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: "# general",
          headerRight: () => (
            <HeaderAccount onPress={() => router.push("/(chat)/account")} />
          ),
          headerLeft: () => (
            <OnlinePill wsStatus={wsStatus} onlineCount={onlineCount} />
          ),
          headerTintColor: theme.textPrimary,
          headerTitleStyle: { color: theme.textPrimary },
          headerShadowVisible: false,
          headerTransparent: true,
        }}
      />

      <View style={styles.list}>
        <FlashList
          data={messages}
          renderItem={({ item }) => <MessageItem message={item} />}
          keyExtractor={(item) => item.id}
          maintainVisibleContentPosition={{ startRenderingFromBottom: true }}
          renderScrollComponent={renderScrollComponent}
          contentContainerStyle={{
            paddingTop: LIST_PADDING,
            paddingBottom: composerHeight + LIST_PADDING,
          }}
        />
      </View>

      {/* Soft scroll-edge fade pinned to the bottom safe-area strip: messages
          stay visible but dissolve into the bg as they slide past the composer
          into the home-indicator zone. Sits under the floating glass composer. */}
      <LinearGradient
        colors={["transparent", theme.bg]}
        style={[styles.edge, { height: bottom + 24 }]}
        pointerEvents="none"
      />

      <KeyboardStickyView style={styles.composer}>
        <View onLayout={handleComposerLayout}>
          <TypingIndicator typingUsers={typingUsers} />
          <Composer onSend={handleSend} sendTyping={sendTyping} />
        </View>
      </KeyboardStickyView>
    </KeyboardGestureArea>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg },
  list: { flex: 1 },
  composer: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
  },
  // Pinned to the very bottom of the screen, height set inline from the safe
  // inset. RN stand-in for iOS 26 scrollEdgeEffectStyle(.soft, .bottom).
  edge: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
  },
});
