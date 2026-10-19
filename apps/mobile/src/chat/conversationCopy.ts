// Pure copy for the conversation surface: the empty-room greeting and the
// typing indicator label (spec goals 3 and 5).

/** "Welcome back, {name}" — bare "Welcome back" when the name is missing or blank. */
export function greeting(username?: string): string {
  const name = username?.trim();
  return name ? `Welcome back, ${name}` : 'Welcome back';
}

/** Typing line for the given peers; "" when nobody types (the indicator renders nothing). */
export function typingLabel(users: readonly string[]): string {
  const [a, b] = users;
  if (users.length === 0) return '';
  if (users.length === 1) return `${a} is typing…`;
  if (users.length === 2) return `${a} and ${b} are typing…`;
  const rest = users.length - 2;
  return `${a}, ${b} and ${rest} ${rest === 1 ? 'other' : 'others'} are typing…`;
}

/**
 * Usernames typing in the room, from Yjs awareness states keyed by clientID.
 * Excludes the local client (and the local user on their other devices), idle
 * or nameless states, and dedupes a peer typing from two clients.
 */
export function typingPeers(
  states: ReadonlyMap<number, Record<string, unknown>>,
  selfClientId: number,
  selfUsername?: string,
): string[] {
  const peers = new Set<string>();
  for (const [clientId, s] of states) {
    if (clientId === selfClientId || s.isTyping !== true) continue;
    if (typeof s.username !== 'string' || s.username === selfUsername) continue;
    peers.add(s.username);
  }
  return [...peers];
}
