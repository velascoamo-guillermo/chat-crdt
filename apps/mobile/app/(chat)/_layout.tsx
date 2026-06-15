import { Stack } from "expo-router";
import { darkTheme as theme } from "../../src/ui";

export default function ChatLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen
        name="index"
        options={{
          contentStyle: { backgroundColor: undefined },
          headerStyle: { backgroundColor: "transparent" },
          headerTitleAlign: "center",
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
          contentStyle: { backgroundColor: theme.surface },
        }}
      />
    </Stack>
  );
}
