import { Stack } from "expo-router";
import { useUITheme } from "../../src/ui";

export default function ChatLayout() {
  const t = useUITheme();

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen
        name="[roomId]"
        // Stack-wide dedupe: without this, router.navigate() does NOT reuse
        // an already-mounted [roomId] entry when the current top-of-stack
        // route is something else (e.g. `rooms`) — StackRouter just pushes a
        // fresh one, mounting a second live SyncEngine/WebSocketProvider/
        // SQLitePersistence for the same room. `dangerouslySingular` makes
        // expo-router derive a getId from the resolved `roomId` param
        // (see expo-router's getSingularId), so navigating to a roomId
        // already in the stack reuses that entry instead of pushing a
        // duplicate; different roomIds still push distinct entries.
        dangerouslySingular
        options={{
          contentStyle: { backgroundColor: undefined },
          headerStyle: { backgroundColor: "transparent" },
          headerTitleAlign: "center",
        }}
      />
      <Stack.Screen
        name="rooms"
        options={{
          headerShown: true,
          title: "Rooms",
          headerTitleAlign: "center",
          contentStyle: { backgroundColor: t.bg },
        }}
      />
      <Stack.Screen
        name="account"
        options={{
          presentation: "formSheet",
          headerShown: false,
          sheetAllowedDetents: [0.45],
          sheetCornerRadius: 24,
          sheetGrabberVisible: true,
          contentStyle: { backgroundColor: t.surface },
        }}
      />
    </Stack>
  );
}
