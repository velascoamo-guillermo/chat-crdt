import { Text } from "@expo/ui/swift-ui";
import { font, foregroundStyle, multilineTextAlignment } from "@expo/ui/swift-ui/modifiers";
import type { SerifTextProps } from "./SerifText.types";

// System serif (New York) — the display face of the empty-room greeting.
export function SerifText({ children, size, color }: SerifTextProps) {
  return (
    <Text
      modifiers={[
        font({ design: "serif", size }),
        foregroundStyle(color),
        multilineTextAlignment("center"),
      ]}
    >
      {children}
    </Text>
  );
}
