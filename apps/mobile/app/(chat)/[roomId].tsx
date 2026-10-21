import { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Platform,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollViewProps,
} from "react-native";
import { FlashList, type FlashListRef } from "@shopify/flash-list";
import type { MessageDto } from "@chat-crdt/shared";
import { LinearGradient } from "expo-linear-gradient";
import {
  KeyboardGestureArea,
  KeyboardStickyView,
} from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Stack, useRouter, useLocalSearchParams } from "expo-router";
import { useRoomMessages, useRoomWsStatus, useRoomCrypto, useRoomLoaded } from "../../src/store/chat.store";
import { useRoomsStore } from "../../src/store/rooms.store";
import { useSync } from "../../src/hooks/useSync";
import { useEnableRoomE2ee } from "../../src/hooks/useE2ee";
import { isComposerReady } from "../../src/crypto/composerGate";
import { MessageItem } from "../../src/components/MessageItem";
import { groupPosition, GROUP_GAP_MS } from "../../src/chat/groupMessages";
import { useAuthStore } from "../../src/store/auth.store";
import { ChatScrollView } from "../../src/components/ChatScrollView";
import { usePresence } from "../../src/hooks/usePresence";
import { TypingIndicator } from "../../src/components/TypingIndicator";
import { EmptyRoom } from "../../src/components/EmptyRoom";
import { showEmptyRoom } from "../../src/chat/emptyRoomGate";
import {
  composerResizeScroll,
  shouldFollowNewMessages,
  isAtListEnd,
  type ScrollMetrics,
} from "../../src/chat/listAnchor";
import { HeaderAccount, HeaderRoomPill, HeaderRoomsDisc } from "../../src/components/ChatHeader";
import { roomLabel, backAction } from "../../src/chat/headerPill";
import { Composer } from "../../src/components/Composer";
import { useChatTheme } from "../../src/ui";
import { isLiquidGlassAvailable } from "expo-glass-effect";
import { computeOrderDigest } from "../../src/utils/orderDigest";
import { isQaReadoutEnabled } from "../../src/qa/qaReadout";

const LIST_PADDING = 8;

// Native stack header content height (excludes the status-bar/safe area, which
// we add separately from the top inset). iOS 44, Android 56.
const HEADER_BASE = Platform.OS === "ios" ? 44 : 56;

// The part of the mounted ScrollView instance the re-anchor uses.
type NativeScroller = { scrollToEnd: (options?: { animated?: boolean }) => void };

// QA-only readout for the Maestro E2E offline-sync flow (apps/mobile/.maestro).
// Off unless the build sets EXPO_PUBLIC_QA_READOUT=1, which the e2e build
// (.maestro/scripts/build-e2e.sh, release config) does. A production bundle
// with the flag fails to build: config/qaReadoutGuard.js, run from
// metro.config.js.
const QA_READOUT_ENABLED = isQaReadoutEnabled(process.env.EXPO_PUBLIC_QA_READOUT);

// ADR-010, Key-rotation trigger list item 0 (enablement): no special actor
// or endpoint beyond the same atomic claim any member can call — in
// practice, whoever is looking at the room, typically the admin/creator.
// Minimal UI surface on purpose (scope discipline, amendment #3): a single
// banner, no room-settings screen. Re-entering the room after enabling is
// what actually picks up the cipher (contentCipher is fixed at SyncEngine
// construction — see useSync.ts), hence router.back() below.
function EnableEncryptionBanner({ roomId }: { roomId: string }) {
  const t = useChatTheme();
  const enableRoomE2ee = useEnableRoomE2ee();
  const router = useRouter();
  const [state, setState] = useState<"idle" | "enabling" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  const handlePress = useCallback(() => {
    setState("enabling");
    setError(null);
    enableRoomE2ee(roomId)
      .then(() => {
        router.back();
        router.navigate(`/(chat)/${roomId}`);
      })
      .catch((err: unknown) => {
        setState("error");
        setError(err instanceof Error ? err.message : "Failed to enable encryption");
      });
  }, [enableRoomE2ee, roomId, router]);

  return (
    <View style={[styles.e2eeBanner, { backgroundColor: t.surface, borderColor: t.border }]}>
      <Pressable
        testID="enable-e2ee-button"
        onPress={handlePress}
        disabled={state === "enabling"}
      >
        <Text style={[styles.e2eeBannerText, { color: t.accent }]}>
          {state === "enabling" ? "Enabling encryption…" : "🔒 Enable end-to-end encryption"}
        </Text>
      </Pressable>
      {error ? <Text style={[styles.e2eeBannerError, { color: t.status.offline }]}>{error}</Text> : null}
    </View>
  );
}

export default function ChatScreen() {
  const { roomId: roomIdParam } = useLocalSearchParams<{ roomId: string }>();
  const roomId = roomIdParam ?? "default";
  const messages = useRoomMessages(roomId);
  const loaded = useRoomLoaded(roomId);
  const myUserId = useAuthStore((s) => s.user?.id);
  const myUsername = useAuthStore((s) => s.user?.username);
  const wsStatus = useRoomWsStatus(roomId);
  const { sendMessage, sendTyping, getAwareness, membership } = useSync(roomId);
  const { typingUsers, onlineCount } = usePresence(getAwareness(), myUsername);
  const router = useRouter();
  const t = useChatTheme();
  const { top, bottom } = useSafeAreaInsets();
  const headerHeight = top + HEADER_BASE;

  const roomSummary = useRoomsStore((s) => s.rooms.find((r) => r.name === roomId));
  const canEnableE2ee = roomId !== "default" && roomSummary?.role === "admin" && roomSummary.currentKeyId === 0;

  // ADR-010 send gate (code review round 1, Critical #1/#3): the room can be
  // E2EE-enabled (currentKeyId > 0) before this device has actually loaded
  // the current epoch's key — sending during that window used to throw an
  // uncaught error out of SyncEngine. `useRoomCrypto`'s `version` field
  // bumps whenever the cipher gains a key (see useE2ee.ts), so this
  // recomputes live as grants load.
  const currentKeyId = roomSummary?.currentKeyId ?? 0;
  const roomCrypto = useRoomCrypto(roomId);
  const composerReady = isComposerReady(currentKeyId, roomCrypto?.cipher ?? null);

  const [composerHeight, setComposerHeight] = useState(0);
  const [sendError, setSendError] = useState<string | null>(null);

  // The composer stack (banners, typing row, pill/card) floats over the list
  // and its height is the list's bottom padding. When it grows or shrinks while
  // the reader is at the end, scroll back to the end so the last bubble stays
  // above it instead of sliding underneath.
  const listRef = useRef<FlashListRef<MessageDto>>(null);
  // At-end is derived here from scroll offset, viewport, content height and
  // the keyboard inset (isAtListEnd), not keyboard-controller's onEndVisible,
  // which ignores the inset and reports "at end" for a reader scrolled up by
  // less than the keyboard height. Recomputed on scroll, layout and inset
  // changes — not on content growth, so a new message is judged against where
  // the reader was before it arrived. False until measured, so mount-time
  // layouts never fight startRenderingFromBottom.
  const metricsRef = useRef<ScrollMetrics>({ offset: 0, visibleHeight: 0, contentHeight: 0, bottomInset: 0 });
  const atEndRef = useRef(false);
  const lastComposerHeight = useRef(0);
  // Set once the first settled composer measurement has snapped the list to the end.
  const snappedRef = useRef(false);
  // A composer resize's padding lands in a later commit, so its end-scroll can
  // run against the old content; Android then doesn't clamp the offset when the
  // content shrinks (card→pill leaves a blank band). Repeat the end-scroll once
  // the new content size is known. Holds the `animated` flag; a drag cancels it.
  const pendingEndRef = useRef<boolean | null>(null);

  // Native scroll view, not FlashList.scrollToEnd: the latter computes its
  // target from estimated item sizes and lands mid-list on Android. Two frames
  // so a just-added row or padding change is laid out first.
  const scrollListToEnd = useCallback((animated: boolean) => {
    // getNativeScrollRef() is typed as the component, but returns the
    // mounted ScrollView instance (our ChatScrollView).
    const scroller = listRef.current?.getNativeScrollRef() as unknown as NativeScroller | null;
    requestAnimationFrame(() => requestAnimationFrame(() => scroller?.scrollToEnd({ animated })));
  }, []);

  const handleComposerLayout = useCallback((e: LayoutChangeEvent) => {
    const next = e.nativeEvent.layout.height;
    const action = composerResizeScroll({
      atEnd: atEndRef.current,
      snapped: snappedRef.current,
      prevHeight: lastComposerHeight.current,
      nextHeight: next,
    });
    if (action === "snap") snappedRef.current = true;
    lastComposerHeight.current = next;
    setComposerHeight(next);
    if (action !== "none") {
      pendingEndRef.current = action === "animate";
      scrollListToEnd(action === "animate");
    }
  }, [scrollListToEnd]);

  // FlashList's startRenderingFromBottom rests a short list on the viewport's
  // bottom edge, ignoring paddingBottom — i.e. under the floating composer.
  // Scrolling to the real end once it has loaded, and after each new message
  // the reader should see, keeps the last bubble above the composer.
  const sentByMeRef = useRef(false);
  const prevCountRef = useRef(messages.length);
  useEffect(() => {
    const follow = shouldFollowNewMessages({
      atEnd: atEndRef.current,
      prevCount: prevCountRef.current,
      nextCount: messages.length,
      sentByMe: sentByMeRef.current,
    });
    prevCountRef.current = messages.length;
    sentByMeRef.current = false;
    if (follow) scrollListToEnd(true);
  }, [messages.length, scrollListToEnd]);

  const handleListLoad = useCallback(() => scrollListToEnd(false), [scrollListToEnd]);

  // (keyboard-controller's extraContentPadding would replace this padding +
  // re-anchor pair, but on Android with Reanimated 4.7 its scroll correction
  // throws "Object is not a function": useExtraContentPadding calls the
  // animated ref inside a nested requestAnimationFrame worklet.)
  // Stable handlers: FlashList's own scroll-view props are read through a ref,
  // so its re-renders (e.g. while scrolling) don't hand keyboard-controller a
  // new onContentInsetChange and re-register its UI-thread reaction.
  const listScrollPropsRef = useRef<ScrollViewProps>({});
  const refreshAtEnd = useCallback(() => {
    atEndRef.current = isAtListEnd(metricsRef.current);
  }, []);
  const handleListScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const n = e.nativeEvent;
      const m = metricsRef.current;
      m.offset = n.contentOffset.y;
      m.contentHeight = n.contentSize.height;
      m.visibleHeight = n.layoutMeasurement.height;
      refreshAtEnd();
      listScrollPropsRef.current.onScroll?.(e);
    },
    [refreshAtEnd],
  );
  const handleListLayout = useCallback(
    (e: LayoutChangeEvent) => {
      metricsRef.current.visibleHeight = e.nativeEvent.layout.height;
      refreshAtEnd();
      listScrollPropsRef.current.onLayout?.(e);
    },
    [refreshAtEnd],
  );
  const handleListContentSize = useCallback(
    (w: number, h: number) => {
      metricsRef.current.contentHeight = h;
      if (pendingEndRef.current !== null) {
        scrollListToEnd(pendingEndRef.current);
        pendingEndRef.current = null;
      }
      listScrollPropsRef.current.onContentSizeChange?.(w, h);
    },
    [scrollListToEnd],
  );
  const handleListBeginDrag = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    pendingEndRef.current = null;
    listScrollPropsRef.current.onScrollBeginDrag?.(e);
  }, []);
  const handleContentInsetChange = useCallback(
    (insets: { bottom?: number }) => {
      metricsRef.current.bottomInset = insets.bottom ?? 0;
      refreshAtEnd();
    },
    [refreshAtEnd],
  );

  // (keyboard-controller's extraContentPadding would replace this padding +
  // re-anchor pair, but on Android with Reanimated 4.7 its scroll correction
  // throws "Object is not a function": useExtraContentPadding calls the
  // animated ref inside a nested requestAnimationFrame worklet.)
  const renderScrollComponent = useCallback(
    (props: ScrollViewProps) => {
      listScrollPropsRef.current = props;
      return (
        <ChatScrollView
          {...props}
          // Closed, the composer sits `bottom` above the screen edge (sticky
          // view offset); open, it rides the keyboard — so the keyboard lift
          // only covers what the static `bottom` padding doesn't.
          offset={bottom}
          onScroll={handleListScroll}
          onLayout={handleListLayout}
          onContentSizeChange={handleListContentSize}
          onScrollBeginDrag={handleListBeginDrag}
          onContentInsetChange={handleContentInsetChange}
        />
      );
    },
    [bottom, handleListScroll, handleListLayout, handleListContentSize, handleListBeginDrag, handleContentInsetChange],
  );

  // Left disc: pop back to Rooms, or — on a cold start straight into a room
  // (no history) — replace this screen with Rooms.
  const handleRoomsPress = useCallback(() => {
    if (backAction(router.canGoBack()) === "back") router.back();
    else router.replace("/(chat)/rooms");
  }, [router]);

  const handleSend = useCallback(
    (content: string) => {
      // Defensive try/catch (code review round 1, Critical #3): the
      // composer gate above is the primary defense, but this stays as a
      // second line — e.g. a race between the gate's render and the tap, or
      // any other future throw path out of SyncEngine.sendMessage. Rethrows
      // so Composer's own handleSend (which called this) knows the send
      // failed and preserves the draft instead of clearing it.
      try {
        sendMessage(content);
        sentByMeRef.current = true;
        setSendError(null);
      } catch (err) {
        setSendError(err instanceof Error ? err.message : "Failed to send message");
        throw err;
      }
    },
    [sendMessage],
  );

  if (membership === "not-a-member") {
    return (
      <View style={styles.notMemberContainer}>
        <Stack.Screen options={{ headerShown: true, title: roomLabel(roomId) }} />
        <Text style={[styles.notMemberText, { color: t.textPrimary }]}>
          You&apos;re not a member of this room.
        </Text>
        <Text
          style={[styles.notMemberLink, { color: t.accent }]}
          onPress={() => router.replace("/(chat)/rooms")}
        >
          Back to rooms
        </Text>
      </View>
    );
  }

  return (
    <KeyboardGestureArea interpolator="ios" style={styles.container}>
      <Stack.Screen
        options={{
          headerShown: true,
          // No title text: the center slot is the room/status pill. `title`
          // still names the screen for VoiceOver's header heading, which
          // otherwise falls back to the route name ("[roomId]").
          title: roomLabel(roomId),
          headerTitle: () => (
            <HeaderRoomPill roomId={roomId} wsStatus={wsStatus} onlineCount={onlineCount} />
          ),
          headerBackVisible: false,
          headerLeft: () => <HeaderRoomsDisc onPress={handleRoomsPress} />,
          headerRight: () => (
            <HeaderAccount onPress={() => router.push("/(chat)/account")} />
          ),
          headerShadowVisible: false,
          headerTransparent: Platform.OS === "ios",
        }}
      />

      <View style={styles.list}>
        <FlashList
          ref={listRef}
          onLoad={handleListLoad}
          data={messages}
          renderItem={({ item, index }) => {
            const g = groupPosition(messages[index - 1], item, messages[index + 1], GROUP_GAP_MS, myUserId);
            return (
              <MessageItem
                message={item}
                isOwn={item.userId === myUserId}
                showAuthor={g.showAuthor}
                isFirstInGroup={g.isFirst}
                isLastInGroup={g.isLast}
              />
            );
          }}
          keyExtractor={(item) => item.id}
          maintainVisibleContentPosition={{ startRenderingFromBottom: true }}
          renderScrollComponent={renderScrollComponent}
          contentContainerStyle={{
            paddingTop: !isLiquidGlassAvailable()
              ? 0
              : headerHeight + LIST_PADDING,
            paddingBottom: composerHeight + bottom + LIST_PADDING,
          }}
        />
        {showEmptyRoom({ loaded, messageCount: messages.length, wsStatus }) ? (
          <EmptyRoom
            username={myUsername}
            top={isLiquidGlassAvailable() ? headerHeight : 0}
            bottom={composerHeight + bottom}
          />
        ) : null}
      </View>

      {/* Soft scroll-edge fade pinned to the bottom safe-area strip: messages
          stay visible but dissolve into the bg as they slide past the composer
          into the home-indicator zone. Sits under the floating glass composer.
          Fade from a zero-alpha bg, not "transparent" (black): interpolating
          from black leaves a grey band on the light canvas. */}
      <LinearGradient
        colors={[`${t.bg}00`, t.bg]}
        style={[styles.edge, { height: bottom + 24 }]}
        pointerEvents="none"
      />

      {/* Lift the composer over the home indicator / nav bar only while the
          keyboard is closed; open, it docks on the keyboard edge. */}
      <KeyboardStickyView style={[styles.composer]} offset={{ closed: -bottom, opened: 0 }}>
        <View onLayout={handleComposerLayout}>
          {canEnableE2ee ? <EnableEncryptionBanner roomId={roomId} /> : null}
          {!composerReady ? (
            <View style={[styles.e2eeBanner, { backgroundColor: t.surface, borderColor: t.border }]}>
              <Text style={[styles.e2eeBannerText, { color: t.textSecondary }]}>
                🔒 Waiting for encryption key…
              </Text>
            </View>
          ) : null}
          {sendError ? (
            <Text style={[styles.e2eeBannerError, { color: t.status.offline, textAlign: "center" }]}>
              {sendError}
            </Text>
          ) : null}
          <TypingIndicator typingUsers={typingUsers} />
          {/* QA-only readout for the Maestro E2E offline-sync flow — gated by
              QA_READOUT_ENABLED (see above), only in the e2e build.
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
          <Composer
            onSend={handleSend}
            sendTyping={sendTyping}
            disabled={!composerReady}
            encrypted={currentKeyId > 0}
          />
        </View>
      </KeyboardStickyView>
    </KeyboardGestureArea>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  list: { flex: 1 },
  e2eeBanner: {
    marginHorizontal: 12,
    marginBottom: 4,
    padding: 10,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
  },
  e2eeBannerText: { fontSize: 13, fontWeight: "600" },
  e2eeBannerError: { fontSize: 11, marginTop: 4 },
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
  notMemberContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    padding: 24,
  },
  notMemberText: {
    fontSize: 16,
    textAlign: "center",
  },
  notMemberLink: {
    fontSize: 15,
    fontWeight: "600",
  },
});
