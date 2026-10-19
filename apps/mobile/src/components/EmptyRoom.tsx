import { memo } from "react";
import { StyleSheet } from "react-native";
import Animated, { useAnimatedStyle } from "react-native-reanimated";
import { useReanimatedKeyboardAnimation } from "react-native-keyboard-controller";
import Asterisk from "@expo/material-symbols/asterisk.xml";
import { Column, Host, Icon, SerifText, decorative, useChatTheme } from "../ui";
import { greeting } from "../chat/conversationCopy";

// SF Symbol (iOS) → Material Symbol (Android); same starburst on both.
const GLYPH = { ios: "asterisk", android: Asterisk } as const;

interface Props {
  username?: string;
  /** Free-space edges: header height above, composer height below. */
  top: number;
  bottom: number;
}

// Empty-room greeting (spec goal 3): accent glyph above a serif "Welcome back".
// An overlay over the list's free space rather than a ListEmptyComponent: a
// flexGrow empty component stays sized to the full list while the keyboard
// lifts the composer, so the greeting sat under the banner. The overlay rises
// by half the keyboard height to stay centered above the lifted composer.
export const EmptyRoom = memo(function EmptyRoom({ username, top, bottom }: Props) {
  const t = useChatTheme();
  const { height } = useReanimatedKeyboardAnimation();
  const lift = useAnimatedStyle(() => ({ transform: [{ translateY: height.value / 2 }] }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.fill, { top, bottom }, lift]}
      testID="empty-room"
    >
      <Host matchContents style={styles.host}>
        <Column alignment="center" spacing={14}>
          <Icon name={GLYPH} size={36} color={t.accent} modifiers={decorative()} />
          <SerifText size={28} color={t.textPrimary}>
            {greeting(username)}
          </SerifText>
        </Column>
      </Host>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  fill: {
    position: "absolute",
    left: 0,
    right: 0,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  host: { backgroundColor: "transparent" },
});
