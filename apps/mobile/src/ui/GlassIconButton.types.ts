import type { ImageSourcePropType } from "react-native";
import type { SFSymbol } from "sf-symbols-typescript";
import type { GlassFallback } from "./modifiers";

export type GlassIconButtonProps = {
  /** SF Symbol on iOS, Material Symbol XML on Android. */
  icon: { ios: SFSymbol; android: ImageSourcePropType };
  /** Accessibility label (VoiceOver / TalkBack / Maestro `tapOn`). */
  label: string;
  onPress: () => void;
  color: string;
  fallback: GlassFallback;
  size?: number;
  glyph?: number;
};
