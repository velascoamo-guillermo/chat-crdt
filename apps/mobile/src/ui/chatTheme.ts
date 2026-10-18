// Chat-scoped Claude-style palette (spec goal 1). Only the chat screen and its
// components use these tokens — rooms/account/auth keep `theme`/`darkTheme`.
// Contrast guarantees (author text on bubble, own text on bubble, send arrow
// on accent) are enforced in chatTheme.test.ts.

export type AuthorColors = {
  /** Muted tint behind the author's messages. */
  bubble: string;
  /** Brighter variant for the author name above a group (on the canvas). */
  name: string;
  /** Message text on `bubble` (WCAG AA). */
  text: string;
};

export type ChatTheme = {
  bg: string;
  surface: string;
  surfaceRaised: string;
  bubbleOwn: string;
  textPrimary: string;
  textSecondary: string;
  placeholder: string;
  border: string;
  accent: string;
  /** Glyph color on top of `accent` (send arrow). */
  accentOn: string;
  /** Translucent fill/border where liquid glass is unavailable (Android). */
  glassFallback: { fill: string; border: string };
  status: { connected: string; connecting: string; offline: string };
  radius: { sm: number; md: number; lg: number; bubble: number; pill: number };
  authors: readonly AuthorColors[];
};

const status = {
  connected: '#22c55e',
  connecting: '#f59e0b',
  offline: '#ef4444',
} as const;

const radius = { sm: 6, md: 12, lg: 20, bubble: 20, pill: 24 } as const;

// Order matters: authors are picked by hashing userId into this index, so reordering
// changes every author's color. Append-only if it ever grows.
export const authorPalette: readonly AuthorColors[] = [
  { bubble: '#4A2C2A', name: '#F2A39A', text: '#F5F4EF' }, // red
  { bubble: '#4A3524', name: '#F0B486', text: '#F5F4EF' }, // orange
  { bubble: '#463C22', name: '#E6C77A', text: '#F5F4EF' }, // amber
  { bubble: '#2C4130', name: '#98D3A0', text: '#F5F4EF' }, // green
  { bubble: '#22403F', name: '#86D1CC', text: '#F5F4EF' }, // teal
  { bubble: '#26364F', name: '#93B4EE', text: '#F5F4EF' }, // blue
  { bubble: '#3A2E4F', name: '#BCA6F0', text: '#F5F4EF' }, // violet
  { bubble: '#4A2A3E', name: '#EE9CC8', text: '#F5F4EF' }, // pink
];

export const authorPaletteLight: readonly AuthorColors[] = [
  { bubble: '#F9DEDB', name: '#A63A2E', text: '#1F1E1C' },
  { bubble: '#FBE5D3', name: '#9A4F1B', text: '#1F1E1C' },
  { bubble: '#F6ECCB', name: '#7D6212', text: '#1F1E1C' },
  { bubble: '#DCEFDF', name: '#2F7A3D', text: '#1F1E1C' },
  { bubble: '#D5EEEC', name: '#1E7570', text: '#1F1E1C' },
  { bubble: '#DCE6F7', name: '#2F5FA8', text: '#1F1E1C' },
  { bubble: '#E7DFF8', name: '#6A49B5', text: '#1F1E1C' },
  { bubble: '#F8DDEB', name: '#A63A78', text: '#1F1E1C' },
];

export const chatDarkTheme: ChatTheme = {
  bg: '#1F1E1C',
  surface: '#2A2927',
  surfaceRaised: '#353431',
  bubbleOwn: '#3A3936',
  textPrimary: '#F5F4EF',
  textSecondary: '#A3A19A',
  placeholder: '#8A8880',
  border: '#3D3C38',
  accent: '#D97757',
  accentOn: '#FFFFFF',
  glassFallback: { fill: '#FFFFFF1F', border: '#FFFFFF24' },
  status,
  radius,
  authors: authorPalette,
};

export const chatTheme: ChatTheme = {
  bg: '#FAF9F5',
  surface: '#F0EEE6',
  surfaceRaised: '#FFFFFF',
  bubbleOwn: '#EAE7DD',
  textPrimary: '#1F1E1C',
  textSecondary: '#6B6962',
  placeholder: '#8F8C84',
  border: '#E3E0D6',
  // Darker than the dark-mode accent so the white send arrow keeps ≥ 3:1.
  accent: '#C6613F',
  accentOn: '#FFFFFF',
  glassFallback: { fill: '#0000000F', border: '#0000001A' },
  status,
  radius,
  authors: authorPaletteLight,
};

/** Pure scheme → palette. Anything but "dark" (null, "unspecified") is light. */
export function chatColors(scheme: string | null | undefined): ChatTheme {
  return scheme === 'dark' ? chatDarkTheme : chatTheme;
}
