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

export type Theme = typeof theme;

// Maps any ws status string to a dot color.
export function statusColor(status: string): string {
  if (status === 'connected') return theme.status.connected;
  if (status === 'connecting') return theme.status.connecting;
  return theme.status.offline;
}
