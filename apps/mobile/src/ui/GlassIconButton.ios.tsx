import { Button, Icon } from "@expo/ui";
import { glassDisc, accessibleLabel } from "./modifiers";
import type { GlassIconButtonProps } from "./GlassIconButton.types";

// Liquid glass disc with an SF Symbol. Icon's accessibilityLabel is Android-only,
// so the label rides on the SwiftUI modifier (see accessibleLabel).
export function GlassIconButton({
  icon,
  label,
  onPress,
  color,
  fallback,
  size = 38,
  glyph = 20,
}: GlassIconButtonProps) {
  return (
    <Button
      variant="text"
      onPress={onPress}
      modifiers={[...glassDisc(fallback, size), ...accessibleLabel(label)]}
    >
      <Icon name={icon.ios} size={glyph} color={color} />
    </Button>
  );
}
