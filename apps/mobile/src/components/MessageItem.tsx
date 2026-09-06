import { memo } from "react";
import { View, Text, StyleSheet } from "react-native";
import type { MessageDto } from "@chat-crdt/shared";
import { useAuthStore } from "../store/auth.store";
import { useUITheme } from "../ui";
import { theme } from "../ui";
import { useRoomCrypto, useRoomPendingEpochsForMe } from "../store/chat.store";
import { resolveMessageRenderState } from "../crypto/renderState";

interface Props {
  message: MessageDto;
}

export const MessageItem = memo(function MessageItem({ message }: Props) {
  const myUserId = useAuthStore((s) => s.user?.id);
  const isOwn = message.userId === myUserId;
  const t = useUITheme();

  // ADR-010: undefined roomCrypto (no cipher for this room, e.g. 'default'
  // or E2EE not yet enabled) resolves via the plaintext no-prefix branch of
  // resolveMessageRenderState, so plain rooms render exactly as before.
  const roomCrypto = useRoomCrypto(message.roomId);
  const pendingEpochsForMe = useRoomPendingEpochsForMe(message.roomId);
  const renderState = resolveMessageRenderState(message, roomCrypto?.cipher ?? null, {
    hasPendingGrantFor: (keyId) => pendingEpochsForMe.has(keyId),
  });

  const displayText =
    renderState.type === "plaintext" || renderState.type === "decrypted"
      ? renderState.text
      : renderState.type === "waiting-for-key"
        ? "🔒 Waiting for encryption key…"
        : "🔒 Message unavailable";

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
          {displayText}
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
