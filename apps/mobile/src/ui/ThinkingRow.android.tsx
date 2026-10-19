import { useState } from "react";
import MoreHoriz from "@expo/material-symbols/more_horiz.xml";
import {
  AnimatedVisibility,
  EnterTransition,
  ExitTransition,
  Host,
  Icon,
  Row,
  Text,
} from "@expo/ui/jetpack-compose";
import { background, clip, padding, Shapes } from "@expo/ui/jetpack-compose/modifiers";
import type { ThinkingRowProps } from "./ThinkingRow.types";

// Quiet "thinking" row on a bubble-like rounded surface at the start edge. Stays
// mounted so Compose's AnimatedVisibility can fade/expand it in and out; the last
// label is kept while it fades out instead of blanking first. The Text is the
// row's only TalkBack node (the Icon has no description), so it is read once.
export function ThinkingRow({ label, color, fill, radius }: ThinkingRowProps) {
  const [shown, setShown] = useState(label);
  if (label && label !== shown) setShown(label);

  return (
    <Host matchContents={{ vertical: true }} style={{ backgroundColor: "transparent" }}>
      <AnimatedVisibility
        visible={label !== ""}
        enterTransition={EnterTransition.fadeIn().plus(EnterTransition.expandVertically())}
        exitTransition={ExitTransition.fadeOut().plus(ExitTransition.shrinkVertically())}
      >
        <Row modifiers={[padding(16, 4, 16, 4)]}>
          <Row
            verticalAlignment="center"
            horizontalArrangement={{ spacedBy: 6 }}
            modifiers={[
              clip(Shapes.RoundedCorner(radius)),
              background(fill),
              padding(12, 7, 12, 7),
            ]}
          >
            <Icon source={MoreHoriz} size={16} tint={color} />
            <Text color={color} style={{ fontSize: 13 }}>
              {shown}
            </Text>
          </Row>
        </Row>
      </AnimatedVisibility>
    </Host>
  );
}
