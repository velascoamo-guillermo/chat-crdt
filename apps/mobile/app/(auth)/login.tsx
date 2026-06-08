import { useCallback, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, StyleSheet, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuthStore } from '../../src/store/auth.store';
import { Host, Column, Text, TextInput, Button, Icon, Spacer, useNativeState, grow, theme } from '../../src/ui';

const H_PADDING = 24;

export default function LoginScreen() {
  const email = useNativeState('');
  const password = useNativeState('');
  const [loading, setLoading] = useState(false);
  const login = useAuthStore(s => s.login);
  const router = useRouter();
  const { width } = useWindowDimensions();
  const contentWidth = width - H_PADDING * 2;

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
      <Host matchContents={{ vertical: true }} style={styles.host}>
        <Column spacing={16} alignment="center" style={styles.column}>
          <Icon name="bubble.left.and.bubble.right.fill" size={56} color={theme.accent} />
          <Text textStyle={styles.title}>Chat CRDT</Text>
          <Text textStyle={styles.subtitle}>Sign in to continue</Text>

          <Spacer />

          <TextInput
            value={email}
            placeholder="Email"
            placeholderTextColor={theme.placeholder}
            autoCapitalize="none"
            keyboardType="email-address"
            autoComplete="email"
            modifiers={grow()}
            style={styles.field}
            textStyle={styles.fieldText}
          />
          <TextInput
            value={password}
            placeholder="Password"
            placeholderTextColor={theme.placeholder}
            secureTextEntry
            autoComplete="password"
            modifiers={grow()}
            style={styles.field}
            textStyle={styles.fieldText}
          />

          <Button
            variant="borderless"
            onPress={handleLogin}
            disabled={loading}
            style={{ width: contentWidth, backgroundColor: theme.accent, borderRadius: theme.radius.lg, paddingVertical: 16 }}
          >
            <Text modifiers={grow()} textStyle={styles.buttonLabel}>
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
  column: { paddingHorizontal: 24, paddingVertical: 32 },
  title: { fontSize: 30, fontWeight: '700', color: theme.textPrimary, textAlign: 'center' },
  subtitle: { fontSize: 15, color: theme.textSecondary, textAlign: 'center' },
  field: {
    backgroundColor: theme.surface,
    borderRadius: theme.radius.lg,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  fieldText: { fontSize: 16, color: theme.textPrimary },
  buttonLabel: { fontSize: 17, fontWeight: '600', color: '#ffffff', textAlign: 'center' },
});
