import { Text } from "@expo/ui/jetpack-compose";
import type { SerifTextProps } from "./SerifText.types";

// Compose FontFamily.Serif (Noto Serif) — the display face of the empty-room greeting.
export function SerifText({ children, size, color }: SerifTextProps) {
  return (
    <Text color={color} style={{ fontSize: size, fontFamily: "serif", textAlign: "center" }}>
      {children}
    </Text>
  );
}
