import { Host, HStack, Image, Text } from "@expo/ui/swift-ui";
import {
  accessibilityElement,
  background,
  font,
  foregroundStyle,
  frame,
  padding,
  shapes,
  symbolEffect,
} from "@expo/ui/swift-ui/modifiers";
import type { ThinkingRowProps } from "./ThinkingRow.types";

// Quiet "thinking" row: grey text beside an ellipsis whose dots light up in turn
// (SF Symbol variableColor, runs on the render server — no JS ticks), on a
// bubble-like capsule hugging the leading edge.
export function ThinkingRow({ label, color, fill, radius }: ThinkingRowProps) {
  if (!label) return null;
  return (
    <Host matchContents={{ vertical: true }} style={{ backgroundColor: "transparent" }}>
      <HStack
        modifiers={[
          frame({ maxWidth: Infinity, alignment: "leading" }),
          padding({ horizontal: 16, vertical: 4 }),
        ]}
      >
        <HStack
          spacing={6}
          modifiers={[
            padding({ horizontal: 12, vertical: 7 }),
            background(fill, shapes.roundedRectangle({ cornerRadius: radius })),
            accessibilityElement("combine"),
          ]}
        >
          <Image
            systemName="ellipsis"
            size={13}
            color={color}
            modifiers={[
              symbolEffect(
                { effect: "variableColor", fillStyle: "iterative", playbackStyle: "reversing" },
                { options: { repeat: "continuous" } },
              ),
            ]}
          />
          <Text modifiers={[font({ size: 13 }), foregroundStyle(color)]}>{label}</Text>
        </HStack>
      </HStack>
    </Host>
  );
}
