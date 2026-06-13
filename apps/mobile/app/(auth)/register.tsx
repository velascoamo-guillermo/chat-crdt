import { useCallback, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuthStore } from '../../src/store/auth.store';
import {
  Host,
  Column,
  Text,
  TextInput,
  Button,
  useNativeState,
  darkTheme as theme,
  pillInput,
  pillButton,
} from '../../src/ui';

export default function RegisterScreen() {
  const email = useNativeState('');
  const username = useNativeState('');
  const password = useNativeState('');
  const [loading, setLoading] = useState(false);
  const register = useAuthStore(s => s.register);
  const router = useRouter();

  const handleRegister = useCallback(async () => {
    const e = email.value.trim();
    const u = username.value.trim();
    const p = password.value;
    if (!e || !u || !p) {
      Alert.alert('Error', 'All fields are required');
      return;
    }
    if (p.length < 8) {
      Alert.alert('Error', 'Password must be at least 8 characters');
      return;
    }
    setLoading(true);
    try {
      await register(e, u, p);
    } catch (err: unknown) {
      Alert.alert('Registration failed', err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [email, username, password, register]);

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <Host matchContents={{ vertical: true }} colorScheme="dark" style={styles.host}>
        <Column spacing={14} style={{ padding: 24 }}>
          <Text textStyle={{ fontSize: 28, fontWeight: '700', color: theme.textPrimary, textAlign: 'center' }}>
            Create Account
          </Text>
          <TextInput
            value={email}
            placeholder="Email"
            placeholderTextColor={theme.placeholder}
            autoCapitalize="none"
            keyboardType="email-address"
            autoComplete="email"
            modifiers={pillInput()}
            textStyle={{ fontSize: 16, color: theme.textPrimary }}
          />
          <TextInput
            value={username}
            placeholder="Username"
            placeholderTextColor={theme.placeholder}
            autoCapitalize="none"
            modifiers={pillInput()}
            textStyle={{ fontSize: 16, color: theme.textPrimary }}
          />
          <TextInput
            value={password}
            placeholder="Password"
            placeholderTextColor={theme.placeholder}
            secureTextEntry
            autoComplete="password"
            modifiers={pillInput()}
            textStyle={{ fontSize: 16, color: theme.textPrimary }}
          />
          <Button variant="text" onPress={handleRegister} modifiers={pillButton(theme.accent)}>
            <Text textStyle={{ fontSize: 16, fontWeight: '600', color: theme.textPrimary }}>
              {loading ? 'Creating…' : 'Register'}
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
  container: { flex: 1, backgroundColor: theme.bg, justifyContent: 'center' },
  host: { backgroundColor: theme.bg },
});
