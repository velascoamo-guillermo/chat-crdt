import { useCallback, useRef } from "react";
import { StyleSheet, View, type LayoutChangeEvent } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { Host, Column, Row, Spacer } from "@expo/ui/jetpack-compose";
import { weight } from "@expo/ui/jetpack-compose/modifiers";
import { composerCard, composerPill } from "../ui";
import { composerHeightStep } from "../chat/composerState";
import type { ComposerSurfaceProps } from "./ComposerSurface.types";

const SPRING = { damping: 22, stiffness: 260, mass: 1 } as const;

// Compose lays the pill/card out instantly (no animateContentSize); this RN
// shell owns the visible height and springs it on the UI thread. The content
// is pinned to the shell's top and the shell to the keyboard edge, so the card
// grows upward and the toolbar is revealed under the field — never pushed
// past the bottom edge behind the nav bar (owner decision on T6 path B).
export function ComposerSurface({ expanded, field, send, chip, surface, border }: ComposerSurfaceProps) {
  const height = useSharedValue(0);
  const applied = useRef<number | null>(null);

  const handleContentLayout = useCallback(
    (e: LayoutChangeEvent) => {
      const step = composerHeightStep(applied.current, e.nativeEvent.layout.height);
      if (!step) return;
      applied.current = step.height;
      height.set(step.animate ? withSpring(step.height, SPRING) : step.height);
    },
    [height],
  );

  const shellStyle = useAnimatedStyle(() => ({ height: height.get() }));

  return (
    <Animated.View style={[styles.shell, { backgroundColor: surface, borderColor: border }, shellStyle]}>
      <View style={styles.content} onLayout={handleContentLayout}>
        <Host matchContents={{ vertical: true }}>
          <Column verticalArrangement={{ spacedBy: 8 }} modifiers={expanded ? composerCard() : composerPill()}>
            <Row verticalAlignment="center" horizontalArrangement={{ spacedBy: 8 }}>
              {field}
              {expanded ? null : send}
            </Row>
            {expanded ? (
              <Row verticalAlignment="center" horizontalArrangement={{ spacedBy: 8 }}>
                {chip}
                <Spacer modifiers={[weight(1)]} />
                {send}
              </Row>
            ) : null}
          </Column>
        </Host>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  shell: {
    marginHorizontal: 12,
    marginBottom: 8,
    borderRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  content: { position: "absolute", top: 0, left: 0, right: 0 },
});
