import { useCallback } from "react";
import { View, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuthStore } from "../../src/store/auth.store";
import {
  Host,
  Column,
  Row,
  Text,
  Button,
  Icon,
  useUITheme,
  pillButton,
} from "../../src/ui";

// Account formSheet: identity summary + logout. Presented as an iOS sheet from
// the chat header's account button (see (chat)/_layout.tsx presentation).
// Identity + logout are @expo/ui islands (SF Symbol on a glass capsule);
// colors come from useUITheme so the sheet follows the system appearance.
export default function AccountScreen() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const { bottom } = useSafeAreaInsets();
  const t = useUITheme();

  // AuthGate (root layout) redirects to /(auth)/login once the token clears,
  // which tears down this sheet — no manual dismiss needed.
  const handleLogout = useCallback(() => {
    logout();
  }, [logout]);

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: t.bg, paddingBottom: bottom + 24 },
      ]}
    >
      <Host
        matchContents={{ horizontal: true, vertical: true }}
        style={styles.identityHost}
      >
        <Column spacing={8} alignment="center">
          <Icon name="person.crop.circle.fill" size={72} color={t.accent} />
          {user?.username ? (
            <Text
              textStyle={{ fontSize: 22, fontWeight: "700", color: t.textPrimary }}
            >
              {user.username}
            </Text>
          ) : null}
          <Text textStyle={{ fontSize: 15, color: t.textSecondary }}>
            {user?.email ?? "Not signed in"}
          </Text>
        </Column>
      </Host>

      <Host matchContents={{ vertical: true }}>
        <Button
          variant="text"
          onPress={handleLogout}
          modifiers={pillButton(t.status.offline)}
        >
          <Row spacing={8} alignment="center">
            <Icon
              name="rectangle.portrait.and.arrow.right"
              size={18}
              color={t.status.offline}
            />
            <Text
              textStyle={{ fontSize: 17, fontWeight: "600", color: t.status.offline }}
            >
              Log out
            </Text>
          </Row>
        </Button>
      </Host>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: 32,
    paddingHorizontal: 24,
    justifyContent: "space-between",
  },
  identityHost: { alignSelf: "center" },
});
