import { useEffect } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { useAuthStore } from '../src/store/auth.store';

function AuthGate({ children }: { children: React.ReactNode }) {
  const { token, isLoading, loadFromStorage } = useAuthStore();
  const router = useRouter();
  const segments = useSegments();

  useEffect(() => {
    loadFromStorage();
  }, []);

  useEffect(() => {
    if (isLoading) return;
    const inAuth = segments[0] === '(auth)';
    if (!token && !inAuth) {
      router.replace('/(auth)/login');
    } else if (token && inAuth) {
      router.replace('/(chat)');
    }
  }, [token, isLoading, segments]);

  return <>{children}</>;
}

export default function RootLayout() {
  return (
    <KeyboardProvider>
      <AuthGate>
        <Stack screenOptions={{ headerShown: false }} />
      </AuthGate>
    </KeyboardProvider>
  );
}
