import { useCallback, useEffect, useState } from "react";
import { View, Text, FlatList, StyleSheet, Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Stack, useRouter } from "expo-router";
import { useRoomsStore, type RoomSummary } from "../../src/store/rooms.store";
import {
  Host,
  Row,
  Button,
  Icon,
  AppTextInput,
  useNativeState,
  useUITheme,
  pillButton,
} from "../../src/ui";

// Room list: create + join flows against the server's REST endpoints
// (GET /rooms, POST /rooms, POST /rooms/:name/join). Reached from the
// account sheet — the default landing route stays /(chat)/default so the
// Maestro suite's post-login assertions keep working (see (chat)/index.tsx).
//
// List rows use plain React Native Text/Pressable, not the @expo/ui native
// islands (Host/Text/Button) — those require a Host boundary and can't be
// dropped into a FlatList render item (see MessageItem.tsx for the same
// convention in the chat message list).
export default function RoomsScreen() {
  const t = useUITheme();
  const router = useRouter();
  const { bottom } = useSafeAreaInsets();
  const { rooms, isLoading, error, fetchRooms, createRoom, joinRoom } =
    useRoomsStore();

  const [actionError, setActionError] = useState<string | null>(null);
  const nameDraft = useNativeState("");

  useEffect(() => {
    fetchRooms();
  }, [fetchRooms]);

  const openRoom = useCallback(
    (room: RoomSummary) => {
      router.push(`/(chat)/${room.name}`);
    },
    [router],
  );

  // Deliberately doesn't clear `nameDraft.value` on success — a successful
  // create/join immediately navigates away via openRoom(), unmounting this
  // screen (and its text field) anyway. Clearing it would mutate a
  // useNativeState-returned value from inside a promise continuation, which
  // the React Compiler ESLint rule (react-hooks/immutability) disallows.
  const handleCreate = useCallback(() => {
    const name = nameDraft.value.trim();
    if (!name) return;
    setActionError(null);
    createRoom(name)
      .then(openRoom)
      .catch((err: unknown) => {
        setActionError(err instanceof Error ? err.message : "Failed to create room");
      });
  }, [nameDraft, createRoom, openRoom]);

  const handleJoin = useCallback(() => {
    const name = nameDraft.value.trim();
    if (!name) return;
    setActionError(null);
    joinRoom(name)
      .then(openRoom)
      .catch((err: unknown) => {
        setActionError(err instanceof Error ? err.message : "Failed to join room");
      });
  }, [nameDraft, joinRoom, openRoom]);

  return (
    <View style={[styles.container, { backgroundColor: t.bg }]}>
      <Stack.Screen options={{ headerShown: true, title: "Rooms" }} />

      <FlatList
        testID="rooms-list"
        data={rooms}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <Pressable
            testID={`room-row-${item.name}`}
            onPress={() => openRoom(item)}
            style={[styles.row, { borderColor: t.border }]}
          >
            <Text style={[styles.roomName, { color: t.textPrimary }]}>
              {`# ${item.name}`}
            </Text>
            <Text style={[styles.roomRole, { color: t.textSecondary }]}>
              {item.role}
            </Text>
          </Pressable>
        )}
        ListEmptyComponent={
          !isLoading ? (
            <Text style={[styles.empty, { color: t.textSecondary }]}>
              No rooms yet — create or join one below.
            </Text>
          ) : null
        }
      />

      {error ? (
        <Text style={[styles.errorText, { color: t.status.offline }]}>{error}</Text>
      ) : null}
      {actionError ? (
        <Text style={[styles.errorText, { color: t.status.offline }]}>
          {actionError}
        </Text>
      ) : null}

      <Host matchContents={{ vertical: true }} style={{ paddingBottom: bottom + 12 }}>
        <Row spacing={12} alignment="center" style={{ padding: 12 }}>
          <AppTextInput value={nameDraft} placeholder="room-name" grow />
          <Button variant="text" onPress={handleJoin} modifiers={pillButton(t.surface)}>
            <Icon name="arrow.right.circle" size={18} color={t.textPrimary} />
          </Button>
          <Button variant="text" onPress={handleCreate} modifiers={pillButton(t.accent)}>
            <Icon name="plus" size={18} color="#ffffff" />
          </Button>
        </Row>
      </Host>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  list: { padding: 16, gap: 8 },
  row: {
    paddingVertical: 14,
    paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  roomName: { fontSize: 16, fontWeight: "600" },
  roomRole: { fontSize: 13 },
  empty: { textAlign: "center", marginTop: 24 },
  errorText: { textAlign: "center", marginHorizontal: 16 },
});
