import { memo } from "react";
import { View, Text, StyleSheet } from "react-native";
import type { MessageDto } from "@chat-crdt/shared";
import { useAuthStore } from "../store/auth.store";
import { useUITheme } from "../ui";
import { theme } from "../ui";

interface Props {
  message: MessageDto;
}

export const MessageItem = memo(function MessageItem({ message }: Props) {
  const myUserId = useAuthStore((s) => s.user?.id);
  const isOwn = message.userId === myUserId;
  const t = useUITheme();

  return (
    <View style={[styles.row, isOwn && styles.rowOwn]}>
      {!isOwn && (
        <Text style={[styles.username, { color: t.textSecondary }]}>
          {message.username}
        </Text>
      )}
      <View
        style={[
          styles.bubble,
          isOwn
            ? [styles.bubbleOwn, { backgroundColor: t.accent }]
            : [styles.bubbleOther, { backgroundColor: t.bubbleOther }],
        ]}
      >
        <Text
          style={[
            [styles.content, { color: t.textPrimary }],
            isOwn && styles.contentOwn,
          ]}
        >
          {message.content}
        </Text>
      </View>
      <Text style={[styles.time, { color: t.placeholder }]}>
        {new Date(message.createdAt).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        })}
      </Text>
    </View>
  );
});

const styles = StyleSheet.create({
  row: { marginVertical: 4, marginHorizontal: 12, alignItems: "flex-start" },
  rowOwn: { alignItems: "flex-end" },
  username: { fontSize: 11, marginBottom: 2, marginLeft: 4 },
  bubble: {
    maxWidth: "75%",
    borderRadius: theme.radius.lg,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  bubbleOwn: {
    borderBottomRightRadius: theme.radius.sm,
  },
  bubbleOther: {
    borderBottomLeftRadius: theme.radius.sm,
  },
  content: { fontSize: 15 },
  contentOwn: { color: "#fff" },
  time: {
    fontSize: 10,
    marginTop: 2,
    marginHorizontal: 4,
  },
});
