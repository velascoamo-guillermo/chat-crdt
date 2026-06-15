import { memo } from "react";
import {
  Host,
  Row,
  Button,
  Text,
  Icon,
  darkTheme,
  theme,
  statusColor,
  glassPill,
  glassDisc,
  useUITheme,
} from "../ui";

const DISC = 38;

// Account action for the native header's right slot — SF Symbol on a liquid
// glass disc. Opens the account formSheet (email + logout). The glass comes
// from the `glassEffect` modifier (iOS); Android uses a translucent fallback.
export const HeaderAccount = memo(function HeaderAccount({
  onPress,
}: {
  onPress: () => void;
}) {
  return (
    <Host matchContents={{ horizontal: true, vertical: true }}>
      <Button variant="text" onPress={onPress} modifiers={glassDisc(DISC)}>
        <Icon name="person.crop.circle.fill" size={28} color={theme.accent} />
      </Button>
    </Host>
  );
});

// Presence indicator for the native header's right slot — a liquid glass pill
// holding a status dot and the online count.
export const OnlinePill = memo(function OnlinePill({
  wsStatus,
  onlineCount,
}: {
  wsStatus: string;
  onlineCount: number;
}) {
  const t = useUITheme();
  return (
    <Host matchContents={{ horizontal: true, vertical: true }}>
      <Row
        spacing={6}
        alignment="center"
        style={{ backgroundColor: t.surface }}
        modifiers={glassPill()}
      >
        <Text textStyle={{ fontSize: 14, color: statusColor(wsStatus) }}>
          ●
        </Text>
        <Text
          textStyle={{
            fontSize: 13,
            fontWeight: "500",
            // color: theme.textPrimary,
          }}
        >
          {`${onlineCount} online`}
        </Text>
      </Row>
    </Host>
  );
});
