import { Stack } from "expo-router";
import { useUITheme } from "../../src/ui";

export default function ChatLayout() {
  const t = useUITheme();

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen
        name="[roomId]"
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
