import { Text } from "@expo/ui/jetpack-compose";
import { semantics } from "@expo/ui/jetpack-compose/modifiers";
import type { SpanTextProps } from "./SpanText.types";

// One Compose Text with styled spans: a single TalkBack node whose content
// description replaces the glyphs ("·", "●"), one line, tail ellipsis.
export function SpanText({ spans, accessibilityLabel }: SpanTextProps) {
  return (
    <Text
      maxLines={1}
      overflow="ellipsis"
      softWrap={false}
      modifiers={[semantics({ contentDescription: accessibilityLabel })]}
    >
      {spans.map((s, i) => (
        <Text
          key={i}
          color={s.color}
          style={{ fontSize: s.size, fontWeight: s.weight === "semibold" ? "600" : "400" }}
        >
          {s.text}
        </Text>
      ))}
    </Text>
  );
}
