import { useCallback } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { SymbolView } from "expo-symbols";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuthStore } from "../../src/store/auth.store";
import { darkTheme as theme } from "../../src/ui";

// Account formSheet: identity summary + logout. Presented as an iOS sheet from
// the chat header's account button (see (chat)/_layout.tsx presentation).
export default function AccountScreen() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const { bottom } = useSafeAreaInsets();

  // AuthGate (root layout) redirects to /(auth)/login once the token clears,
  // which tears down this sheet — no manual dismiss needed.
  const handleLogout = useCallback(() => {
    logout();
  }, [logout]);

  return (
    <View style={[styles.container, { paddingBottom: bottom + 24 }]}>
      <View style={styles.identity}>
        <SymbolView
          name="person.crop.circle.fill"
          size={72}
          weight="regular"
          tintColor={theme.accent}
        />
        {user?.username ? (
          <Text style={styles.username}>{user.username}</Text>
        ) : null}
        <Text style={styles.email}>{user?.email ?? "Not signed in"}</Text>
      </View>

      <Pressable
        onPress={handleLogout}
        style={({ pressed }) => [styles.logout, pressed && styles.logoutPressed]}
        hitSlop={8}
      >
        <SymbolView
          name="rectangle.portrait.and.arrow.right"
          size={18}
          weight="semibold"
          tintColor={theme.status.offline}
        />
        <Text style={styles.logoutLabel}>Log out</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.surface,
    paddingTop: 32,
    paddingHorizontal: 24,
    alignItems: "center",
    justifyContent: "space-between",
  },
  identity: {
    alignItems: "center",
    gap: 8,
  },
  username: {
    fontSize: 22,
    fontWeight: "700",
    color: theme.textPrimary,
  },
  email: {
    fontSize: 15,
    color: theme.textSecondary,
  },
  logout: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    alignSelf: "stretch",
    height: 52,
    borderRadius: theme.radius.lg,
    backgroundColor: theme.bg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
  },
  logoutPressed: { opacity: 0.6 },
  logoutLabel: {
    fontSize: 17,
    fontWeight: "600",
    color: theme.status.offline,
  },
});
