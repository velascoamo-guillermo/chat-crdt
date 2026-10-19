import { Host, VStack, HStack, Spacer } from "@expo/ui/swift-ui";
import { animation, Animation } from "@expo/ui/swift-ui/modifiers";
import { composerCard, composerPill } from "../ui";
import type { ComposerSurfaceProps } from "./ComposerSurface.types";

const SPRING = Animation.spring({ response: 0.38, dampingFraction: 0.82 });

// One Host, bottom-aligned: RN only learns the final height, so SwiftUI keeps
// the content anchored to the keyboard edge while the spring grows the card
// upward. Spike T6 path (B).
export function ComposerSurface({ expanded, field, send, chip }: ComposerSurfaceProps) {
  return (
    <Host matchContents={{ vertical: true }} alignment="bottom" style={{ marginHorizontal: 12, marginBottom: 8 }}>
      <VStack
        alignment="leading"
        spacing={10}
        modifiers={[...(expanded ? composerCard() : composerPill()), animation(SPRING, expanded)]}
      >
        <HStack spacing={8}>
          {field}
          {expanded ? null : send}
        </HStack>
        {expanded ? (
          <HStack spacing={8}>
            {chip}
            <Spacer />
            {send}
          </HStack>
        ) : null}
      </VStack>
    </Host>
  );
}
