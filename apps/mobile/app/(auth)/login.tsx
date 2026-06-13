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

export default function LoginScreen() {
  const email = useNativeState('');
  const password = useNativeState('');
  const [loading, setLoading] = useState(false);
  const login = useAuthStore(s => s.login);
  const router = useRouter();

  const handleLogin = useCallback(async () => {
    if (loading) return;
    const e = email.value.trim();
    const p = password.value;
    if (!e || !p) {
      Alert.alert('Error', 'Email and password are required');
      return;
    }
    setLoading(true);
    try {
      await login(e, p);
    } catch (err: unknown) {
      Alert.alert('Login failed', err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [email, password, login, loading]);

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <Host matchContents={{ vertical: true }} colorScheme="dark" style={styles.host}>
        <Column spacing={14} style={{ padding: 24 }}>
          <Text textStyle={{ fontSize: 28, fontWeight: '700', color: theme.textPrimary, textAlign: 'center' }}>
            Chat CRDT
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
            value={password}
            placeholder="Password"
            placeholderTextColor={theme.placeholder}
            secureTextEntry
            autoComplete="password"
            modifiers={pillInput()}
            textStyle={{ fontSize: 16, color: theme.textPrimary }}
          />
          <Button variant="text" onPress={handleLogin} modifiers={pillButton(theme.accent)}>
            <Text textStyle={{ fontSize: 16, fontWeight: '600', color: theme.textPrimary }}>
              {loading ? 'Logging in…' : 'Login'}
            </Text>
          </Button>
          <Button
            variant="text"
            label="No account? Register"
            onPress={() => router.push('/(auth)/register')}
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
