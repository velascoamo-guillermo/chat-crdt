import { useCallback, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, StyleSheet, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuthStore } from '../../src/store/auth.store';
import { Host, Column, Text, TextInput, Button, Icon, Spacer, useNativeState, grow, theme } from '../../src/ui';

const H_PADDING = 24;

export default function RegisterScreen() {
  const email = useNativeState('');
  const username = useNativeState('');
  const password = useNativeState('');
  const [loading, setLoading] = useState(false);
  const register = useAuthStore(s => s.register);
  const router = useRouter();
  const { width } = useWindowDimensions();
  const contentWidth = width - H_PADDING * 2;

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
      <Host matchContents={{ vertical: true }} style={styles.host}>
        <Column spacing={16} alignment="center" style={styles.column}>
          <Icon name="person.crop.circle.badge.plus" size={56} color={theme.accent} />
          <Text textStyle={styles.title}>Create Account</Text>
          <Text textStyle={styles.subtitle}>Join the conversation</Text>

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
            value={username}
            placeholder="Username"
            placeholderTextColor={theme.placeholder}
            autoCapitalize="none"
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
            onPress={handleRegister}
            disabled={loading}
            style={{ width: contentWidth, backgroundColor: theme.accent, borderRadius: theme.radius.lg, paddingVertical: 16 }}
          >
            <Text modifiers={grow()} textStyle={styles.buttonLabel}>
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
  column: { paddingHorizontal: H_PADDING, paddingVertical: 32 },
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
