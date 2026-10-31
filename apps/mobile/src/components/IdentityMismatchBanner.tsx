import { memo, useCallback, useState } from "react";
import { Alert, StyleSheet } from "react-native";
import { Button, Column, Host, Text, glassActionPill, glassCard, useChatTheme } from "../ui";
import { useAuthStore } from "../store/auth.store";
import { IDENTITY_BANNER_COPY as COPY, resetDeviceKeyFlow, showIdentityBanner } from "../chat/identityBanner";

// Destructive confirm (owner policy a): resetting revokes the key the user's
// other device holds, so say so before doing it.
function confirmReset(): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      COPY.confirmTitle,
      COPY.confirmBody,
      [
        { text: COPY.cancel, style: "cancel", onPress: () => resolve(false) },
        { text: COPY.confirmAction, style: "destructive", onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

/**
 * T15 fix 2: shown while this device's E2EE key differs from the one
 * published for the account (identityStatus 'mismatch'). Offers to replace
 * it, which republishes from this device.
 */
export const IdentityMismatchBanner = memo(function IdentityMismatchBanner() {
  const t = useChatTheme();
  const status = useAuthStore((s) => s.identityStatus);
  const resetIdentity = useAuthStore((s) => s.resetIdentity);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const handleReset = useCallback(async () => {
    setFailed(false);
    const outcome = await resetDeviceKeyFlow({
      confirm: confirmReset,
      reset: async () => {
        setBusy(true);
        await resetIdentity();
      },
      getStatus: () => useAuthStore.getState().identityStatus,
    });
    setBusy(false);
    setFailed(outcome === "failed");
  }, [resetIdentity]);

  if (!showIdentityBanner(status)) return null;

  return (
    <Host matchContents={{ vertical: true }} style={styles.host} testID="identity-mismatch-banner">
      <Column alignment="start" spacing={10} modifiers={glassCard(t.glassFallback)}>
        <Text textStyle={{ fontSize: 15, fontWeight: "600", color: t.textPrimary }}>{COPY.title}</Text>
        <Text textStyle={{ fontSize: 13, color: t.textSecondary }}>{failed ? COPY.failed : COPY.body}</Text>
        <Button variant="text" onPress={busy ? undefined : handleReset} modifiers={glassActionPill(t.accent)}>
          <Text textStyle={{ fontSize: 14, fontWeight: "600", color: t.accentOn }}>
            {busy ? COPY.resetting : COPY.action}
          </Text>
        </Button>
      </Column>
    </Host>
  );
});

const styles = StyleSheet.create({
  host: { marginHorizontal: 12, marginBottom: 6 },
});
