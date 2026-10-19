import { memo } from "react";
import { StyleSheet, View } from "react-native";
import Asterisk from "@expo/material-symbols/asterisk.xml";
import { Column, Host, Icon, SerifText, useChatTheme } from "../ui";
import { greeting } from "../chat/conversationCopy";

// SF Symbol (iOS) → Material Symbol (Android); same starburst on both.
const GLYPH = { ios: "asterisk", android: Asterisk } as const;

interface Props {
  username?: string;
}

// Empty-room greeting (spec goal 3): accent glyph above a serif "Welcome back".
// The wrapper fills the list's free space so the island centers between header
// and composer (the list's content container must flexGrow).
export const EmptyRoom = memo(function EmptyRoom({ username }: Props) {
  const t = useChatTheme();
  return (
    <View style={styles.fill} testID="empty-room">
      <Host matchContents style={styles.host}>
        <Column alignment="center" spacing={14}>
          <Icon name={GLYPH} size={36} color={t.accent} />
          <SerifText size={28} color={t.textPrimary}>
            {greeting(username)}
          </SerifText>
        </Column>
      </Host>
    </View>
  );
});

const styles = StyleSheet.create({
  fill: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 24 },
  host: { backgroundColor: "transparent" },
});
