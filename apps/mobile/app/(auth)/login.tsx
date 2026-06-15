import { useCallback, useState } from "react";
import { Alert, StyleSheet } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useRouter } from "expo-router";
import { useAuthStore } from "../../src/store/auth.store";
import {
  Host,
  Column,
  Text,
  AppTextInput,
  Button,
  useNativeState,
  useUITheme,
  darkTheme as theme,
  pillButton,
} from "../../src/ui";

export default function LoginScreen() {
  const email = useNativeState("");
  const password = useNativeState("");
  const [loading, setLoading] = useState(false);
  const login = useAuthStore((s) => s.login);
  const router = useRouter();
  const t = useUITheme();

  const handleLogin = useCallback(async () => {
    if (loading) return;
    const e = email.value.trim();
    const p = password.value;
    if (!e || !p) {
      Alert.alert("Error", "Email and password are required");
      return;
    }
    setLoading(true);
    try {
      await login(e, p);
    } catch (err: unknown) {
      Alert.alert(
        "Login failed",
        err instanceof Error ? err.message : "Unknown error",
      );
    } finally {
      setLoading(false);
    }
  }, [email, password, login, loading]);

  return (
    <KeyboardAvoidingView style={[styles.container]} behavior="padding">
      <Host matchContents={{ vertical: true }}>
        <Column spacing={14} style={{ padding: 24 }}>
          <Text
            textStyle={{
              fontSize: 28,
              fontWeight: "700",
              color: t.textPrimary,
              textAlign: "center",
            }}
          >
            Chat CRDT
          </Text>
          <AppTextInput
            value={email}
            label="Email"
            placeholder="Email"
            autoCapitalize="none"
            keyboardType="email-address"
          />
          <AppTextInput
            value={password}
            label="Password"
            placeholder="Password"
            secureTextEntry
          />
          <Button
            variant="text"
            onPress={handleLogin}
            modifiers={pillButton(theme.accent)}
          >
            <Text
              textStyle={{
                fontSize: 16,
                fontWeight: "600",
                color: theme.textPrimary,
              }}
            >
              {loading ? "Logging in…" : "Login"}
            </Text>
          </Button>
          <Button
            variant="text"
            label="No account? Register"
            onPress={() => router.push("/(auth)/register")}
          />
        </Column>
      </Host>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: "center" },
});
