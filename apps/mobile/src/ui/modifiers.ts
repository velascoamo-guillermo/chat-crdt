import { Platform } from "react-native";
import {
  frame,
  padding,
  buttonStyle,
  glassEffect,
} from "@expo/ui/swift-ui/modifiers";
import {
  weight,
  size,
  clip,
  background,
  border,
  paddingAll,
  Shapes,
  fillMaxWidth,
} from "@expo/ui/jetpack-compose/modifiers";

// 6-digit hex -> 8-digit hex with the given alpha (00–FF). Lets us reuse the
// iOS tint colors as translucent fills for the Android glass fallback.
function withAlpha(hex: string, alpha: string) {
  return /^#[0-9a-fA-F]{6}$/.test(hex) ? `${hex}${alpha}` : hex;
}

// Make a Row/Column child expand to fill available main-axis space.
export function grow() {
  return Platform.OS === "android"
    ? [weight(1)]
    : [frame({ maxWidth: Infinity })];
}

// Pill-shaped text field on a liquid glass capsule. Android fakes it with a
// translucent rounded surface + hairline border.
export function pillInput() {
  if (Platform.OS === "android") {
    return [
      clip(Shapes.RoundedCorner(24)),
      background("#FFFFFF1F"),
      border(1, "#FFFFFF24"),
      // paddingAll(12),
    ];
  }
  return [
    padding({ horizontal: 16, vertical: 12 }),
    glassEffect({
      glass: { variant: "regular", interactive: true },
      shape: "capsule",
    }),
  ];
}

// Full-width pill CTA on a liquid glass capsule. Pass a tint (e.g. the accent)
// to color the glass. Android fakes it with a translucent rounded surface.
export function pillButton(tint = "#FFFFFF") {
  if (Platform.OS === "android") {
    return [
      clip(Shapes.RoundedCorner(28)),
      background(withAlpha(tint, "2E")),
      fillMaxWidth(),
    ];
  }
  return [
    buttonStyle("plain"),
    frame({ maxWidth: Infinity }),
    padding({ horizontal: 24, vertical: 16 }),
    glassEffect({
      glass: { variant: "regular", tint, interactive: true },
      shape: "capsule",
    }),
  ];
}

// Small liquid glass capsule for header chips (e.g. the presence pill).
// Android fakes it with a translucent rounded surface + hairline border.
export function glassPill() {
  if (Platform.OS === "android") {
    return [clip(Shapes.RoundedCorner(14)), paddingAll(8)];
  }
  return [
    padding({ horizontal: 12, vertical: 6 }),
    glassEffect({ glass: { variant: "regular" }, shape: "capsule" }),
  ];
}

// Circular liquid glass disc for header icon buttons (e.g. the account button).
// Android fakes it with a translucent tinted circle + border.
export function glassDisc(size_ = 38) {
  if (Platform.OS === "android") {
    return [size(size_, size_), clip(Shapes.Circle)];
  }
  return [
    frame({ width: size_, height: size_ }),
    glassEffect({
      glass: { variant: "regular", interactive: true },
      shape: "circle",
    }),
  ];
}

// Circular liquid glass icon button. Defaults to a neutral white tint; pass a
// color (e.g. the accent) to tint the glass — used to give the send button affordance.
// `interactive` glass reacts to press on iOS; Android approximates with a
// translucent tinted circle + border.
export function circleButton(size_ = 44, tint = "#FFFFFF") {
  if (Platform.OS === "android") {
    return [
      size(size_, size_),
      clip(Shapes.Circle),
      background(withAlpha(tint, "2E")),
    ];
  }
  return [
    buttonStyle("plain"),
    frame({ width: size_, height: size_ }),
    glassEffect({
      glass: { variant: "regular", tint, interactive: true },
      shape: "circle",
    }),
  ];
}
