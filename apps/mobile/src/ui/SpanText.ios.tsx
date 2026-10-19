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
  // Segment-only changes (e.g. colors on a live dark/light switch) don't re-render
  // the concatenated SwiftUI Text, which kept the previous scheme's colors. Keying
  // on the styled content remounts it whenever any segment changes.
  const key = spans.map((s) => `${s.text}|${s.color}|${s.size}|${s.weight ?? ""}`).join("\n");
  return (
    <Text
      key={key}
      modifiers={[lineLimit(1), truncationMode("tail"), a11yLabel(accessibilityLabel)]}>
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
