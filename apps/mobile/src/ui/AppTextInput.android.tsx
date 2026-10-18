import { useEffect, useRef } from "react";
import { Keyboard } from "react-native";
import {
  OutlinedTextField,
  type TextFieldRef,
  Text,
  type TextFieldKeyboardType,
  type TextFieldCapitalization,
  type TextFieldImeAction,
} from "@expo/ui/jetpack-compose";
import { weight, fillMaxWidth } from "@expo/ui/jetpack-compose/modifiers";
import type { ComponentProps } from "react";
import { useUITheme } from "./useUITheme";
import type { AppTextInputProps } from "./AppTextInput.types";

const KEYBOARD: Record<
  NonNullable<AppTextInputProps["keyboardType"]>,
  TextFieldKeyboardType
> = {
  default: "text",
  "email-address": "email",
  numeric: "number",
  "phone-pad": "phone",
};

const CAPITALIZATION: Record<
  NonNullable<AppTextInputProps["autoCapitalize"]>,
  TextFieldCapitalization
> = {
  none: "none",
  sentences: "sentences",
  words: "words",
  characters: "characters",
};

const IME: Record<
  NonNullable<AppTextInputProps["returnKeyType"]>,
  TextFieldImeAction
> = {
  done: "done",
  go: "go",
  next: "next",
  search: "search",
  send: "send",
};

export function AppTextInput({
  value,
  onChangeText,
  onFocusChange,
  onSubmitEditing,
  placeholder,
  placeholderColor,
  color,
  fontSize = 16,
  accentColor,
  autoCapitalize = "sentences",
  keyboardType = "default",
  secureTextEntry = false,
  returnKeyType,
  multiline = false,
  autoFocus = false,
  grow = false,
  label,
}: AppTextInputProps) {
  // Material3 components don't follow the system here — resolve colors from the
  // active scheme so the field adapts to light/dark. Callers can still override.
  const t = useUITheme();
  const textColor = color ?? t.textPrimary;
  const placeholder_ = placeholderColor ?? t.placeholder;
  const accent = accentColor ?? t.accent;
  const ref = useRef<TextFieldRef>(null);

  // Compose keeps focus after the IME hides (interactive dismiss, back), so a
  // focus listener would never see `false`. Blur explicitly on keyboard hide —
  // only for callers that track focus, to leave other fields untouched.
  const tracksFocus = onFocusChange !== undefined;
  useEffect(() => {
    if (!tracksFocus) return;
    const sub = Keyboard.addListener("keyboardDidHide", () => {
      void ref.current?.blur();
    });
    return () => sub.remove();
  }, [tracksFocus]);
  return (
    <OutlinedTextField
      ref={ref}
      onFocusChanged={onFocusChange}
      value={value as ComponentProps<typeof OutlinedTextField>["value"]}
      onValueChange={onChangeText}
      autoFocus={autoFocus}
      modifiers={grow ? [weight(1)] : [fillMaxWidth()]}
      singleLine={!multiline}
      visualTransformation={secureTextEntry ? "password" : "none"}
      textStyle={{ fontSize, color: textColor }}
      keyboardOptions={{
        keyboardType: KEYBOARD[keyboardType],
        capitalization: CAPITALIZATION[autoCapitalize],
        imeAction: returnKeyType ? IME[returnKeyType] : "default",
      }}
      keyboardActions={
        onSubmitEditing
          ? {
              onDone: onSubmitEditing,
              onGo: onSubmitEditing,
              onNext: onSubmitEditing,
              onSearch: onSubmitEditing,
              onSend: onSubmitEditing,
            }
          : undefined
      }
      colors={{
        focusedIndicatorColor: accent,
        cursorColor: accent,
        focusedTextColor: textColor,
        unfocusedTextColor: textColor,
        focusedPlaceholderColor: placeholder_,
        unfocusedPlaceholderColor: placeholder_,
      }}
    >
      {placeholder ? (
        <OutlinedTextField.Placeholder>
          <Text>{placeholder}</Text>
        </OutlinedTextField.Placeholder>
      ) : null}
      {label ? (
        <OutlinedTextField.Label>
          <Text>{label}</Text>
        </OutlinedTextField.Label>
      ) : null}
    </OutlinedTextField>
  );
}
