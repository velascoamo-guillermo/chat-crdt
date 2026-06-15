import { useColorScheme } from "react-native";
import { theme, darkTheme, type Theme } from "./theme";

/**
 * Returns the palette for the current system appearance.
 *
 * expo/ui native components on Android render with Compose's default *light*
 * scheme and do not follow the system — and the `Host` does not propagate a
 * Compose theme to nested children. So light/dark must be driven explicitly
 * from JS. On iOS SwiftUI islands already adapt, but using the same palette
 * keeps both platforms consistent and deterministic.
 */
export function useUITheme(): Theme {
  return useColorScheme() === "dark" ? darkTheme : theme;
}
