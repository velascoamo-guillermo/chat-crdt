import { memo } from "react";
import { View, useColorScheme, useWindowDimensions } from "react-native";
import MenuIcon from "@expo/material-symbols/menu.xml";
import AccountCircle from "@expo/material-symbols/account_circle.xml";
import {
  Host,
  Row,
  Button,
  Text,
  Icon,
  glassPill,
  glassDisc,
  accessibleLabel,
  accessibleGroup,
  useChatTheme,
} from "../ui";
import {
  roomLabel,
  presenceLabel,
  statusTone,
  headerPillA11yLabel,
  pillSlotWidth,
} from "../chat/headerPill";

// Header Hosts sit inside the native nav bar, which keeps a light appearance
// in dark mode — glass would render light behind light text. Pin the system scheme.
function useHostScheme(): "light" | "dark" {
  return useColorScheme() === "dark" ? "dark" : "light";
}

const DISC = 38;
const PILL_SLOT_HEIGHT = 44;
const GLYPH = 20;
// Icon-only buttons, no visible text — must be reachable by an accessibility
// label for VoiceOver and for Maestro's `tapOn: "Account"` (see
// accessibleLabel in ui/modifiers.ts for why this needs both the Icon prop
// AND the iOS-only SwiftUI modifier).
const ROOMS_LABEL = "Rooms";
const ACCOUNT_LABEL = "Account";

// SF Symbol (iOS) → Material Symbol (Android); a bare SF name renders nothing on Android.
const MENU_ICON = { ios: "line.3.horizontal", android: MenuIcon } as const;
const ACCOUNT_ICON = { ios: "person.crop.circle", android: AccountCircle } as const;

// Glass icon disc shared by the left and right header slots.
const HeaderDisc = memo(function HeaderDisc({
  icon,
  label,
  onPress,
}: {
  icon: typeof MENU_ICON | typeof ACCOUNT_ICON;
  label: string;
  onPress: () => void;
}) {
  const t = useChatTheme();
  const scheme = useHostScheme();
  return (
    <Host matchContents={{ horizontal: true, vertical: true }} colorScheme={scheme}>
      <Button
        variant="text"
        onPress={onPress}
        modifiers={[...glassDisc(t.glassFallback, DISC), ...accessibleLabel(label)]}
      >
        <Icon name={icon} size={GLYPH} color={t.textPrimary} accessibilityLabel={label} />
      </Button>
    </Host>
  );
});

// Left slot: back to the rooms list. The screen decides pop vs replace (see backAction).
export const HeaderRoomsDisc = memo(function HeaderRoomsDisc({
  onPress,
}: {
  onPress: () => void;
}) {
  return <HeaderDisc icon={MENU_ICON} label={ROOMS_LABEL} onPress={onPress} />;
});

// Right slot: opens the account formSheet (email + logout).
export const HeaderAccount = memo(function HeaderAccount({
  onPress,
}: {
  onPress: () => void;
}) {
  return <HeaderDisc icon={ACCOUNT_ICON} label={ACCOUNT_LABEL} onPress={onPress} />;
});

// Center slot (replaces the title): display-only glass pill reading
// `# room · ● N online`, dot colored by ws status. Screen readers get one
// element whose label starts with the room name — Maestro matches on that.
export const HeaderRoomPill = memo(function HeaderRoomPill({
  roomId,
  wsStatus,
  onlineCount,
}: {
  roomId: string;
  wsStatus: string;
  onlineCount: number;
}) {
  const t = useChatTheme();
  const scheme = useHostScheme();
  const { width } = useWindowDimensions();
  // Fixed-size slot: see pillSlotWidth for why the pill can't size itself here.
  return (
    <View
      pointerEvents="none"
      style={{
        width: pillSlotWidth(width),
        height: PILL_SLOT_HEIGHT,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Host matchContents={{ horizontal: true, vertical: true }} colorScheme={scheme}>
        <Row
          spacing={6}
          alignment="center"
          modifiers={[
            ...glassPill(t.glassFallback),
            ...accessibleGroup(headerPillA11yLabel(roomId, wsStatus, onlineCount)),
          ]}
        >
          <Text textStyle={{ fontSize: 15, fontWeight: "600", color: t.textPrimary }}>
            {roomLabel(roomId)}
          </Text>
          <Text textStyle={{ fontSize: 13, color: t.textSecondary }}>·</Text>
          <Text textStyle={{ fontSize: 10, color: t.status[statusTone(wsStatus)] }}>●</Text>
          <Text textStyle={{ fontSize: 13, color: t.textSecondary }}>
            {presenceLabel(onlineCount)}
          </Text>
        </Row>
      </Host>
    </View>
  );
});
