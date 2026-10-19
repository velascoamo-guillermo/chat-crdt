import { memo } from "react";
import { View, useColorScheme, useWindowDimensions } from "react-native";
import MenuIcon from "@expo/material-symbols/menu.xml";
import AccountCircle from "@expo/material-symbols/account_circle.xml";
import {
  Host,
  Row,
  SpanText,
  GlassIconButton,
  glassPill,
  useChatTheme,
  type GlassIconButtonProps,
} from "../ui";
import {
  pillRoomLabel,
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

const PILL_SLOT_HEIGHT = 44;
// Icon-only buttons, no visible text — the label is what VoiceOver/TalkBack read
// and what Maestro's `tapOn: "Account"` matches.
const ROOMS_LABEL = "Rooms";
const ACCOUNT_LABEL = "Account";

// SF Symbol (iOS) → Material Symbol (Android); a bare SF name renders nothing on Android.
const MENU_ICON: GlassIconButtonProps["icon"] = { ios: "line.3.horizontal", android: MenuIcon };
const ACCOUNT_ICON: GlassIconButtonProps["icon"] = { ios: "person.crop.circle", android: AccountCircle };

// Glass icon disc shared by the left and right header slots.
const HeaderDisc = memo(function HeaderDisc({
  icon,
  label,
  onPress,
}: {
  icon: GlassIconButtonProps["icon"];
  label: string;
  onPress: () => void;
}) {
  const t = useChatTheme();
  const scheme = useHostScheme();
  return (
    <Host matchContents={{ horizontal: true, vertical: true }} colorScheme={scheme}>
      <GlassIconButton
        icon={icon}
        label={label}
        onPress={onPress}
        color={t.textPrimary}
        fallback={t.glassFallback}
      />
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
// `# room · ● N online`, dot colored by ws status. One native text node, so
// screen readers get a single stop labelled "# room, <status>, N online" —
// Maestro matches on the leading room name.
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
  const slot = pillSlotWidth(width);
  // Fixed-size slot: see pillSlotWidth for why the pill can't size itself here.
  return (
    <View
      pointerEvents="none"
      style={{
        width: slot,
        height: PILL_SLOT_HEIGHT,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Host matchContents={{ horizontal: true, vertical: true }} colorScheme={scheme}>
        <Row alignment="center" modifiers={glassPill(t.glassFallback)}>
          <SpanText
            accessibilityLabel={headerPillA11yLabel(roomId, wsStatus, onlineCount)}
            spans={[
              { text: pillRoomLabel(roomId, slot), color: t.textPrimary, size: 15, weight: "semibold" },
              { text: "  ·  ", color: t.textSecondary, size: 13 },
              { text: "●", color: t.status[statusTone(wsStatus)], size: 13 },
              { text: ` ${presenceLabel(onlineCount)}`, color: t.textSecondary, size: 13 },
            ]}
          />
        </Row>
      </Host>
    </View>
  );
});
