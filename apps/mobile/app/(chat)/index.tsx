import { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Platform,
  type LayoutChangeEvent,
  type ScrollViewProps,
  useColorScheme,
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
import { darkTheme, theme } from "../../src/ui";
import { isLiquidGlassAvailable } from "expo-glass-effect";
import { computeOrderDigest } from "../../src/utils/orderDigest";

const LIST_PADDING = 8;
// Native stack header content height (excludes the status-bar/safe area, which
// we add separately from the top inset). iOS 44, Android 56.
const HEADER_BASE = Platform.OS === "ios" ? 44 : 56;

// QA-only readout for the Maestro E2E offline-sync flow (apps/mobile/.maestro).
// Requires BOTH __DEV__ (never true in a release build, regardless of env
// misconfiguration) AND an explicit opt-in env var — so it stays invisible in
// ordinary local dev too, and only run.sh's Metro invocation (which sets
// EXPO_PUBLIC_QA_READOUT=1) turns it on. Verify by launching without the env
// var: the readout is absent even though __DEV__ is true.
const QA_READOUT_ENABLED =
  __DEV__ && process.env.EXPO_PUBLIC_QA_READOUT === "1";

export default function ChatScreen() {
  const scheme = useColorScheme();
  const messages = useChatStore((s) => s.messages);
  const wsStatus = useChatStore((s) => s.wsStatus);
  const { sendMessage, sendTyping, getAwareness } = useSync();
  const { typingUsers, onlineCount } = usePresence(getAwareness());
  const router = useRouter();
  const { top, bottom } = useSafeAreaInsets();
  const headerHeight = top + HEADER_BASE;

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
          headerTintColor: "white",
          headerRight: () => (
            <HeaderAccount onPress={() => router.push("/(chat)/account")} />
          ),
          headerLeft: () => (
            <OnlinePill wsStatus={wsStatus} onlineCount={onlineCount} />
          ),
          headerShadowVisible: false,
          headerTransparent: Platform.OS === "ios",
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
            paddingTop: !isLiquidGlassAvailable()
              ? 0
              : headerHeight + LIST_PADDING,
            paddingBottom: composerHeight + LIST_PADDING,
          }}
        />
      </View>

      {/* Soft scroll-edge fade pinned to the bottom safe-area strip: messages
          stay visible but dissolve into the bg as they slide past the composer
          into the home-indicator zone. Sits under the floating glass composer. */}
      <LinearGradient
        colors={["transparent", scheme === "dark" ? darkTheme.bg : theme.bg]}
        style={[styles.edge, { height: bottom + 24 }]}
        pointerEvents="none"
      />

      <KeyboardStickyView style={[styles.composer]}>
        <View onLayout={handleComposerLayout}>
          <TypingIndicator typingUsers={typingUsers} />
          {/* QA-only readout for the Maestro E2E offline-sync flow — gated by
              QA_READOUT_ENABLED (see above), never present in a release build.
              Three signals the flow can't get from scraping bubble text alone:
              - chat-message-count: exact merged count. Yjs updates are
                idempotent (applying the same op twice is a no-op), so this
                isn't catching duplicated CRDT ops — it catches app-level bugs
                that re-send a message as a *new* op (two distinct array
                entries with identical text) or that lose one.
              - chat-order-digest: hash of rendered content in list order
                (computeOrderDigest, src/utils/orderDigest.ts). Presence
                assertions alone can't distinguish convergent order from any
                other permutation of the same 5 texts; the flow compares this
                against the same digest computed independently by the headless
                client B script over its own final view.
              - chat-ws-status: raw wsStatus ("connected"/"connecting"/
                "disconnected"), so the flow can assert a real round trip
                (part 1) and a real severed connection (part 2) instead of
                inferring connection state from message delivery alone. */}
          {QA_READOUT_ENABLED && (
            <>
              <Text testID="chat-message-count" style={styles.debugReadout}>
                {`${messages.length} msgs`}
              </Text>
              <Text testID="chat-order-digest" style={styles.debugReadout}>
                {computeOrderDigest(messages.map((m) => m.content))}
              </Text>
              <Text testID="chat-ws-status" style={styles.debugReadout}>
                {wsStatus}
              </Text>
            </>
          )}
          <Composer onSend={handleSend} sendTyping={sendTyping} />
        </View>
      </KeyboardStickyView>
    </KeyboardGestureArea>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  list: { flex: 1 },
  debugReadout: {
    alignSelf: "center",
    fontSize: 9,
    opacity: 0.35,
    marginBottom: 2,
  },
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
