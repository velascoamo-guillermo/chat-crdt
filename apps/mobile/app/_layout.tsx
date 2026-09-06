import { useEffect } from "react";
import { Stack, useRouter, useSegments } from "expo-router";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { useAuthStore } from "../src/store/auth.store";
import { RoomKeyStore } from "../src/crypto/keyStore";
import { secureStoreBackend } from "../src/crypto/secureStoreBackend";
import { ensureIdentityPublished, type KeyFlowsContext } from "../src/crypto/keyFlows";

const API = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3001";
const identityKeyStore = new RoomKeyStore(secureStoreBackend);

function AuthGate({ children }: { children: React.ReactNode }) {
  const { token, isLoading, loadFromStorage } = useAuthStore();
  const router = useRouter();
  const segments = useSegments();

  useEffect(() => {
    loadFromStorage();
  }, []);

  // ADR-010: publish this device's X25519 public key as soon as we have a
  // token, independent of any specific room's E2EE status — a member's
  // public key must exist BEFORE anyone can wrap a room key for them, so
  // this can't be deferred until they happen to open an already-enabled
  // room (that room might be exactly the one currently being enabled).
  // Covers pre-ADR users (lazy publish on next login) and fresh registers.
  useEffect(() => {
    if (!token) return;
    const ctx: KeyFlowsContext = { apiBase: API, token };
    // Best-effort: a transient failure here (server unreachable right after
    // app launch, brief network blip) shouldn't surface as an unhandled
    // promise rejection — the identity publish gets retried on the next
    // token change (e.g. re-login) or the next E2EE-enabled room mount
    // (useE2eeCipher calls ensureIdentityPublished too, idempotently).
    ensureIdentityPublished(ctx, identityKeyStore).catch(() => undefined);
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
