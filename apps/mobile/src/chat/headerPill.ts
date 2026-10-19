// Pure copy/logic for the chat header (spec goal 2): the center room/status
// pill and the left "back to rooms" disc. No RN imports so it runs under bun test.

export type StatusTone = 'connected' | 'connecting' | 'offline';
export type BackAction = 'back' | 'replace-rooms';

// The 'default' room is the pre-existing single-room-MVP lobby — it keeps the
// original "# general" copy the Maestro suite (apps/mobile/.maestro) asserts
// on. Any other room shows its own slug.
export function roomLabel(roomId: string): string {
  return roomId === 'default' ? '# general' : `# ${roomId}`;
}

export function presenceLabel(onlineCount: number): string {
  return `${onlineCount} online`;
}

/** Any ws status but connected/connecting (e.g. "disconnected") reads as offline. */
export function statusTone(wsStatus: string): StatusTone {
  if (wsStatus === 'connected') return 'connected';
  if (wsStatus === 'connecting') return 'connecting';
  return 'offline';
}

/** Screen-reader label for the whole pill. Must start with roomLabel — Maestro matches on it. */
export function headerPillA11yLabel(roomId: string, wsStatus: string, onlineCount: number): string {
  return `${roomLabel(roomId)}, ${statusTone(wsStatus)}, ${presenceLabel(onlineCount)}`;
}

/** Left disc: pop if there is history, else (cold start into a room) replace with Rooms. */
export function backAction(canGoBack: boolean): BackAction {
  return canGoBack ? 'back' : 'replace-rooms';
}
