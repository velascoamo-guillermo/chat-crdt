export const theme = {
  accent: '#0066ff',
  bg: '#ffffff',
  surface: '#f0f0f0',
  textPrimary: '#111111',
  textSecondary: '#888888',
  placeholder: '#aaaaaa',
  border: '#eeeeee',
  bubbleOther: '#f0f0f0',
  status: {
    connected: '#22c55e',
    connecting: '#f59e0b',
    offline: '#ef4444',
  },
  radius: { sm: 4, md: 8, lg: 16, pill: 20 },
} as const;

// Dark palette for the chat surface (chat screen + composer). Same shape as
// `theme` so chat components can swap it in via `import { darkTheme as theme }`.
export const darkTheme = {
  accent: '#0066ff',
  bg: '#0a0a0a',
  surface: '#1c1c1e',
  textPrimary: '#ffffff',
  textSecondary: '#8e8e93',
  placeholder: '#6b6b6e',
  border: '#2c2c2e',
  bubbleOther: '#1c1c1e',
  status: {
    connected: '#22c55e',
    connecting: '#f59e0b',
    offline: '#ef4444',
  },
  radius: { sm: 4, md: 8, lg: 16, pill: 20 },
} as const;

export type Theme = {
  accent: string;
  bg: string;
  surface: string;
  textPrimary: string;
  textSecondary: string;
  placeholder: string;
  border: string;
  bubbleOther: string;
  status: { connected: string; connecting: string; offline: string };
  radius: { sm: number; md: number; lg: number; pill: number };
};

// Maps any ws status string to a dot color.
export function statusColor(status: string): string {
  if (status === 'connected') return theme.status.connected;
  if (status === 'connecting') return theme.status.connecting;
  return theme.status.offline;
}
