import { useColorScheme } from "react-native";
import { chatColors, type ChatTheme } from "./chatTheme";

/** Chat-scoped palette for the current system appearance (see chatTheme.ts). */
export function useChatTheme(): ChatTheme {
  return chatColors(useColorScheme());
}
