import { Text } from "@expo/ui/swift-ui";
import {
  font,
  foregroundStyle,
  lineLimit,
  truncationMode,
  accessibilityLabel as a11yLabel,
} from "@expo/ui/swift-ui/modifiers";
import type { SpanTextProps } from "./SpanText.types";

// One SwiftUI Text built by concatenating styled segments: a single
// accessibility element (no per-segment VoiceOver stops), one line, tail ellipsis.
export function SpanText({ spans, accessibilityLabel }: SpanTextProps) {
  return (
    <Text modifiers={[lineLimit(1), truncationMode("tail"), a11yLabel(accessibilityLabel)]}>
      {spans.map((s, i) => (
        <Text
          key={i}
          modifiers={[
            font({ size: s.size, weight: s.weight ?? "regular" }),
            foregroundStyle(s.color),
          ]}
        >
          {s.text}
        </Text>
      ))}
    </Text>
  );
}
