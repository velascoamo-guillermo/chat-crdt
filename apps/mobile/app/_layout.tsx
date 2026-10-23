import { useEffect } from "react";
import { LogBox } from "react-native";
import { Stack, useRouter, useSegments } from "expo-router";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { useAuthStore } from "../src/store/auth.store";

// Maestro E2E runs only (same opt-in as the chat QA readout, see [roomId].tsx):
// a LogBox toast sits over the composer and swallows taps on "Message…".
// Warnings still reach the Metro console.
if (__DEV__ && process.env.EXPO_PUBLIC_QA_READOUT === "1") {
  LogBox.ignoreAllLogs(true);
}

function AuthGate({ children }: { children: React.ReactNode }) {
  const { token, isLoading, loadFromStorage, syncIdentity } = useAuthStore();
  const router = useRouter();
  const segments = useSegments();

  useEffect(() => {
    loadFromStorage();
  }, []);

  // ADR-010 / T15: reconcile this user's identity key whenever the signed-in
  // account changes (see auth.store syncIdentity).
  useEffect(() => {
    if (!token) return;
    syncIdentity();
  }, [token]);

  useEffect(() => {
    if (isLoading) return;
    const inAuth = segments[0] === "(auth)";
    if (!token && !inAuth) {
      router.replace("/(auth)/login");
    } else if (token && inAuth) {
      router.replace("/(chat)");
    }
  }, [token, isLoading, segments]);

  return <>{children}</>;
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <KeyboardProvider>
          <AuthGate>
            <Stack
              screenOptions={{
                headerShown: false,
                contentStyle: { backgroundColor: undefined },
              }}
            />
          </AuthGate>
        </KeyboardProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
