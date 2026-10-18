// T6 spike — throwaway, never merged.
// One Host, one BasicTextField at a stable tree position. The container
// Column animates its own size (animateContentSize); the toolbar row and the
// inline send button enter/leave via AnimatedVisibility.
import { useCallback, useEffect, useState, type ComponentProps } from "react";
import {
  Host,
  Column,
  Row,
  BasicTextField,
  AnimatedVisibility,
  EnterTransition,
  ExitTransition,
  IconButton,
  Icon,
  Text,
  Spacer,
  useNativeState,
} from "@expo/ui/jetpack-compose";
import {
  animateContentSize,
  background,
  border,
  clip,
  fillMaxWidth,
  padding,
  paddingAll,
  size,
  weight,
  Shapes,
} from "@expo/ui/jetpack-compose/modifiers";
import ArrowUp from "@expo/material-symbols/arrow_upward.xml";
import Lock from "@expo/material-symbols/lock.xml";
import type { SpikeComposerProps } from "./SpikeComposer.types";

const ACCENT = "#D97757";
const SURFACE = "#2A2A2C";

function ProbedTextField({ onMount, ...props }: ComponentProps<typeof BasicTextField> & { onMount: () => void }) {
  useEffect(onMount, [onMount]);
  return <BasicTextField {...props} />;
}

export function SpikeComposer({ e2ee, animated, onFieldMount, onSend }: SpikeComposerProps) {
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
    <IconButton
      onClick={send}
      modifiers={[size(34, 34), clip(Shapes.Circle), background(hasText ? ACCENT : "#FFFFFF2E")]}
    >
      <Icon source={ArrowUp} size={18} tint="#FFFFFF" />
    </IconButton>
  );

  const enter = animated ? EnterTransition.expandVertically().plus(EnterTransition.fadeIn()) : EnterTransition.fadeIn({ initialAlpha: 1 });
  const exit = animated ? ExitTransition.shrinkVertically().plus(ExitTransition.fadeOut()) : ExitTransition.fadeOut({ targetAlpha: 1 });
  const enterH = animated ? EnterTransition.expandHorizontally().plus(EnterTransition.fadeIn()) : enter;
  const exitH = animated ? ExitTransition.shrinkHorizontally().plus(ExitTransition.fadeOut()) : exit;

  return (
    <Host matchContents={{ vertical: true }} style={{ marginHorizontal: 12 }}>
      <Column
        modifiers={[
          fillMaxWidth(),
          clip(Shapes.RoundedCorner(24)),
          background(SURFACE),
          border(1, "#FFFFFF1A"),
          ...(animated ? [animateContentSize(0.82, 600)] : []),
          padding(16, 7, 8, 7),
        ]}
      >
        <Row verticalAlignment="center">
          <ProbedTextField
            onMount={onFieldMount}
            value={text}
            onValueChange={handleChange}
            onFocusChanged={setFocused}
            singleLine={false}
            maxLines={6}
            cursorColor={ACCENT}
            textStyle={{ color: "#FFFFFF", fontSize: 17 }}
            keyboardOptions={{ imeAction: "default" }}
            modifiers={[weight(1), padding(0, 8, 0, 8)]}
          >
            <BasicTextField.Placeholder>
              <Text color="#8E8E93" style={{ fontSize: 17 }}>Chat with Claude</Text>
            </BasicTextField.Placeholder>
          </ProbedTextField>
          <AnimatedVisibility visible={!expanded} enterTransition={enterH} exitTransition={exitH}>
            {sendButton}
          </AnimatedVisibility>
        </Row>
        <AnimatedVisibility visible={expanded} enterTransition={enter} exitTransition={exit}>
          <Row verticalAlignment="center" modifiers={[fillMaxWidth(), padding(0, 4, 0, 0)]}>
            {e2ee ? (
              <Row
                verticalAlignment="center"
                horizontalArrangement={{ spacedBy: 4 }}
                modifiers={[clip(Shapes.RoundedCorner(14)), background("#FFFFFF1F"), paddingAll(6)]}
              >
                <Icon source={Lock} size={12} tint="#BBBBBB" />
                <Text color="#BBBBBB" style={{ fontSize: 13 }}>Encrypted</Text>
              </Row>
            ) : null}
            <Spacer modifiers={[weight(1)]} />
            {sendButton}
          </Row>
        </AnimatedVisibility>
      </Column>
    </Host>
  );
}
