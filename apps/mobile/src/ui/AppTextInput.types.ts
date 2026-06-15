import type { ObservableState } from "@expo/ui";

/**
 * Cross-platform outlined text input. Renders a Material3 `OutlinedTextField`
 * on Android and a SwiftUI `TextField`/`SecureField` with `.roundedBorder`
 * style on iOS. Must be rendered inside an `@expo/ui` `Host`.
 */
export type AppTextInputProps = {
  /** Observable text state. Create with `useNativeState("")`. */
  value: ObservableState<string>;
  onChangeText?: (text: string) => void;
  /** Fired when the keyboard action button (return/send/done) is pressed. */
  onSubmitEditing?: () => void;
  placeholder?: string;
  label?: string;
  placeholderColor?: string;
  /** Text + cursor color. */
  color?: string;
  fontSize?: number;
  /** Outline / border color when focused. Defaults to the theme accent. */
  accentColor?: string;
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
  keyboardType?: "default" | "email-address" | "numeric" | "phone-pad";
  secureTextEntry?: boolean;
  returnKeyType?: "done" | "go" | "next" | "search" | "send";
  multiline?: boolean;
  autoFocus?: boolean;
  /** Expand to fill the available main-axis space inside a `Row`/`Column`. */
  grow?: boolean;
  /**
   * iOS only — wrap the field in a liquid-glass capsule instead of the
   * Material-style rounded border outline. @default true
   */
  glassEffect?: boolean;
};
