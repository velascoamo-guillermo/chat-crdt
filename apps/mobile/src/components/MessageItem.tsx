import { memo } from "react";
import { View, Text, StyleSheet } from "react-native";
import type { MessageDto } from "@chat-crdt/shared";
import { useAuthStore } from "../store/auth.store";
import { useChatTheme } from "../ui";
import { authorColors } from "../chat/authorColor";
import { useRoomCrypto, useRoomPendingEpochsForMe } from "../store/chat.store";
import { useRoomsStore } from "../store/rooms.store";
import { resolveMessageRenderState } from "../crypto/renderState";

interface Props {
  message: MessageDto;
  /** Author name above this bubble — first of a group, never own messages. */
  showAuthor?: boolean;
  isFirstInGroup?: boolean;
  /** Timestamp renders only under the last bubble of a group. */
  isLastInGroup?: boolean;
}

export const MessageItem = memo(function MessageItem({
  message,
  showAuthor = true,
  isFirstInGroup = true,
  isLastInGroup = true,
}: Props) {
  const myUserId = useAuthStore((s) => s.user?.id);
  const isOwn = message.userId === myUserId;
  const c = useChatTheme();
  const author = authorColors(message.userId, c.authors);

  // ADR-010: undefined roomCrypto (no cipher for this room, e.g. 'default'
  // or E2EE not yet enabled) resolves via the plaintext no-prefix branch of
  // resolveMessageRenderState, so plain rooms render exactly as before.
  const roomCrypto = useRoomCrypto(message.roomId);
  const pendingEpochsForMe = useRoomPendingEpochsForMe(message.roomId);
  // message.roomId is the room's slug/name (same identifier useE2eeCipher and
  // the [roomId] route use), not the server's RoomSummary.id — matches how
  // roomCryptoByRoom itself is keyed (setRoomCipher(roomIdOrName, ...)).
  const roomIsE2eeEnabled =
    (useRoomsStore((s) => s.rooms.find((r) => r.name === message.roomId)?.currentKeyId) ?? 0) > 0;
  const renderState = resolveMessageRenderState(
    message,
    roomCrypto?.cipher ?? null,
    { hasPendingGrantFor: (keyId) => pendingEpochsForMe.has(keyId) },
    roomIsE2eeEnabled
  );

  const isPlain = renderState.type === "plaintext" || renderState.type === "decrypted";
  const displayText = isPlain
    ? renderState.text
    : renderState.type === "waiting-for-key"
      ? "🔒 Waiting for encryption key…"
      : "🔒 Message unavailable";

  const bubbleColor = isOwn ? c.bubbleOwn : author.bubble;
  const textColor = isOwn ? c.textPrimary : author.text;

  // Inner corners of a group tighten so consecutive bubbles read as one run
  // (outer corners keep the full radius).
  const r = c.radius.bubble;
  const tight = c.radius.sm;
  const corners = isOwn
    ? {
        borderTopRightRadius: isFirstInGroup ? r : tight,
        borderBottomRightRadius: isLastInGroup ? r : tight,
      }
    : {
        borderTopLeftRadius: isFirstInGroup ? r : tight,
        borderBottomLeftRadius: isLastInGroup ? r : tight,
      };

  return (
    <View
      style={[
        styles.row,
        isOwn && styles.rowOwn,
        { marginTop: isFirstInGroup ? 10 : 2 },
      ]}
    >
      {showAuthor && !isOwn ? (
        <Text style={[styles.username, { color: author.name }]} numberOfLines={1}>
          {message.username}
        </Text>
      ) : null}
      <View style={[styles.bubble, { backgroundColor: bubbleColor, borderRadius: r }, corners]}>
        <Text
          style={[
            styles.content,
            { color: textColor },
            !isPlain && styles.contentMuted,
          ]}
        >
          {displayText}
        </Text>
      </View>
      {isLastInGroup ? (
        <Text style={[styles.time, { color: c.textSecondary }]}>
          {new Date(message.createdAt).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </Text>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  row: { marginHorizontal: 12, alignItems: "flex-start" },
  rowOwn: { alignItems: "flex-end" },
  // Explicit lineHeight so Android font metrics don't clip the name line.
  username: { fontSize: 12, lineHeight: 16, fontWeight: "600", marginBottom: 4, marginLeft: 12 },
  bubble: {
    maxWidth: "80%",
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderCurve: "continuous",
  },
  content: { fontSize: 16, lineHeight: 22 },
  // E2EE waiting/unavailable: same geometry, muted italic.
  contentMuted: { fontStyle: "italic", opacity: 0.7 },
  time: { fontSize: 11, marginTop: 4, marginHorizontal: 12 },
});
