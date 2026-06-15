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

export default function RegisterScreen() {
  const email = useNativeState("");
  const username = useNativeState("");
  const password = useNativeState("");
  const [loading, setLoading] = useState(false);
  const register = useAuthStore((s) => s.register);
  const router = useRouter();
  const t = useUITheme();

  const handleRegister = useCallback(async () => {
    const e = email.value.trim();
    const u = username.value.trim();
    const p = password.value;
    if (!e || !u || !p) {
      Alert.alert("Error", "All fields are required");
      return;
    }
    if (p.length < 8) {
      Alert.alert("Error", "Password must be at least 8 characters");
      return;
    }
    setLoading(true);
    try {
      await register(e, u, p);
    } catch (err: unknown) {
      Alert.alert(
        "Registration failed",
        err instanceof Error ? err.message : "Unknown error",
      );
    } finally {
      setLoading(false);
    }
  }, [email, username, password, register]);

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
            Create Account
          </Text>
          <AppTextInput
            value={email}
            placeholder="Email"
            autoCapitalize="none"
            keyboardType="email-address"
          />
          <AppTextInput
            value={username}
            placeholder="Username"
            autoCapitalize="none"
          />
          <AppTextInput
            value={password}
            placeholder="Password"
            secureTextEntry
          />
          <Button
            variant="text"
            onPress={handleRegister}
            modifiers={pillButton(theme.accent)}
          >
            <Text
              textStyle={{
                fontSize: 16,
                fontWeight: "600",
                color: theme.textPrimary,
              }}
            >
              {loading ? "Creating…" : "Register"}
            </Text>
          </Button>
          <Button
            variant="text"
            label="Have an account? Login"
            onPress={() => router.back()}
          />
        </Column>
      </Host>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: "center" },
});
