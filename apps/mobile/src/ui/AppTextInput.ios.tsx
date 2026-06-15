import { TextField, SecureField, Text } from "@expo/ui/swift-ui";
import {
  textFieldStyle,
  keyboardType as keyboardTypeModifier,
  textInputAutocapitalization,
  autocorrectionDisabled,
  submitLabel,
  onSubmit,
  foregroundStyle,
  font,
  tint,
  frame,
  padding,
  glassEffect as glassEffectModifier,
  type ModifierConfig,
} from "@expo/ui/swift-ui/modifiers";
import type { ComponentProps } from "react";
import { darkTheme as theme } from "./theme";
import type { AppTextInputProps } from "./AppTextInput.types";

const CAPITALIZATION = {
  none: "never",
  sentences: "sentences",
  words: "words",
  characters: "characters",
} as const;

export function AppTextInput({
  value,
  onChangeText,
  onSubmitEditing,
  placeholder,
  placeholderColor,
  color,
  fontSize = 16,
  accentColor = theme.accent,
  autoCapitalize = "sentences",
  keyboardType = "default",
  secureTextEntry = false,
  returnKeyType,
  multiline = false,
  autoFocus = false,
  grow = false,
  glassEffect = true,
}: AppTextInputProps) {
  // Only force `tint` (accent). Leave text/placeholder unset so SwiftUI uses
  // its system semantic colors (`Color.primary` / secondary), which adapt to
  // light/dark mode automatically. Callers can still override per-field.
  const modifiers: ModifierConfig[] = [tint(accentColor), font({ size: fontSize })];
  if (color) modifiers.push(foregroundStyle(color));
  // Glass capsule (default) vs Material-style rounded border outline.
  if (glassEffect) {
    modifiers.push(
      padding({ horizontal: 16, vertical: 12 }),
      glassEffectModifier({
        glass: { variant: "regular", interactive: true },
        shape: "capsule",
      }),
    );
  } else {
    modifiers.push(textFieldStyle("roundedBorder"));
  }
  if (grow) modifiers.push(frame({ maxWidth: Infinity }));
  if (returnKeyType) modifiers.push(submitLabel(returnKeyType));
  if (onSubmitEditing) modifiers.push(onSubmit(onSubmitEditing));

  const placeholderSlot = placeholder ? (
    <TextField.Placeholder>
      <Text modifiers={placeholderColor ? [foregroundStyle(placeholderColor)] : []}>
        {placeholder}
      </Text>
    </TextField.Placeholder>
  ) : null;

  if (secureTextEntry) {
    return (
      <SecureField
        text={value as ComponentProps<typeof SecureField>["text"]}
        onTextChange={onChangeText}
        autoFocus={autoFocus}
        placeholder={placeholder}
        modifiers={modifiers}
      >
        {placeholderSlot}
      </SecureField>
    );
  }

  return (
    <TextField
      text={value as ComponentProps<typeof TextField>["text"]}
      onTextChange={onChangeText}
      autoFocus={autoFocus}
      placeholder={placeholder}
      axis={multiline ? "vertical" : "horizontal"}
      modifiers={[
        ...modifiers,
        keyboardTypeModifier(keyboardType),
        textInputAutocapitalization(CAPITALIZATION[autoCapitalize]),
        autocorrectionDisabled(keyboardType === "email-address"),
      ]}
    >
      {placeholderSlot}
    </TextField>
  );
}
