// T6 spike — throwaway, never merged.
// One Host, one TextField at a stable tree position. Collapsed = capsule
// (roundedRectangle r=24 at ~48pt tall); expanded = same shape, taller, plus a
// toolbar row. The send button hops rows via matchedGeometryEffect.
import { useCallback, useEffect, useId, useState, type ComponentProps } from "react";
import {
  Host,
  VStack,
  HStack,
  TextField,
  Button,
  Image,
  Text,
  Spacer,
  Namespace,
  useNativeState,
} from "@expo/ui/swift-ui";
import {
  animation,
  Animation,
  glassEffect,
  matchedGeometryEffect,
  padding,
  frame,
  font,
  tint,
  buttonStyle,
  foregroundStyle,
  onSubmit,
  submitLabel,
} from "@expo/ui/swift-ui/modifiers";
import type { SpikeComposerProps } from "./SpikeComposer.types";

const ACCENT = "#D97757";
const SPRING = Animation.spring({ response: 0.38, dampingFraction: 0.82 });

// Transparent wrapper: its effect re-fires iff React remounts the field.
function ProbedTextField({ onMount, ...props }: ComponentProps<typeof TextField> & { onMount: () => void }) {
  useEffect(onMount, [onMount]);
  return <TextField {...props} />;
}

export function SpikeComposer({ e2ee, animated, onFieldMount, onSend }: SpikeComposerProps) {
  const ns = useId();
  const text = useNativeState("");
  const [focused, setFocused] = useState(false);
  const [hasText, setHasText] = useState(false);
  const expanded = focused || hasText;

  const handleChange = useCallback((v: string) => {
    const next = v.trim().length > 0;
    setHasText((prev) => (prev === next ? prev : next));
  }, []);

  const send = useCallback(() => {
    const v = text.value.trim();
    if (!v) return;
    onSend(v);
    text.value = "";
    setHasText(false);
  }, [onSend, text]);

  const sendButton = (
    <Button
      onPress={send}
      modifiers={[
        buttonStyle("plain"),
        frame({ width: 34, height: 34 }),
        glassEffect({
          glass: { variant: "regular", tint: hasText ? ACCENT : "#FFFFFF33", interactive: true },
          shape: "circle",
        }),
        matchedGeometryEffect("send", ns),
      ]}
    >
      <Image systemName="arrow.up" size={16} color="white" />
    </Button>
  );

  return (
    <Host matchContents={{ vertical: true }} alignment="bottom" style={{ marginHorizontal: 12 }}>
      <Namespace id={ns}>
        <VStack
          alignment="leading"
          spacing={10}
          modifiers={[
            padding({ leading: 16, trailing: 8, top: 7, bottom: 7 }),
            frame({ maxWidth: Infinity, alignment: "leading" }),
            glassEffect({ glass: { variant: "regular" }, shape: "roundedRectangle", cornerRadius: 24 }),
            ...(animated ? [animation(SPRING, expanded)] : []),
          ]}
        >
          <HStack spacing={8}>
            {/* Index 0 in both states → React never remounts it. */}
            <ProbedTextField
              onMount={onFieldMount}
              text={text}
              onTextChange={handleChange}
              onFocusChange={setFocused}
              axis="vertical"
              placeholder="Chat with Claude"
              modifiers={[
                tint(ACCENT),
                font({ size: 17 }),
                frame({ maxWidth: Infinity, minHeight: 34, alignment: "leading" }),
                submitLabel("send"),
                onSubmit(send),
              ]}
            />
            {expanded ? null : sendButton}
          </HStack>
          {expanded ? (
            <HStack spacing={8}>
              {e2ee ? (
                <HStack
                  spacing={4}
                  modifiers={[
                    padding({ horizontal: 10, vertical: 6 }),
                    glassEffect({ glass: { variant: "regular" }, shape: "capsule" }),
                  ]}
                >
                  <Image systemName="lock.fill" size={12} color="#BBBBBB" />
                  <Text modifiers={[font({ size: 13 }), foregroundStyle("#BBBBBB")]}>Encrypted</Text>
                </HStack>
              ) : null}
              <Spacer />
              {sendButton}
            </HStack>
          ) : null}
        </VStack>
      </Namespace>
    </Host>
  );
}
