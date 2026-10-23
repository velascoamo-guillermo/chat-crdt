import { Box, Icon } from "@expo/ui/jetpack-compose";
import { clickable } from "@expo/ui/jetpack-compose/modifiers";
import { glassDisc } from "./modifiers";
import type { GlassIconButtonProps } from "./GlassIconButton.types";

// A Material TextButton imposes its own min size, shape and padding (the disc came
// out as a rounded square with a shrunken glyph), so build the disc directly: a
// circular Box with the glassFallback fill + hairline, clickable after the clip so
// the ripple stays round. clickable merges the Icon's description into one node.
export function GlassIconButton({
  icon,
  label,
  onPress,
  color,
  fallback,
  size = 38,
  glyph = 22,
}: GlassIconButtonProps) {
  return (
    <Box
      contentAlignment="center"
      modifiers={[...glassDisc(fallback, size), clickable(onPress)]}
    >
      <Icon source={icon.android} size={glyph} tint={color} contentDescription={label} />
    </Box>
  );
}
