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

// Per-side space the header discs take: 16 bar inset + 38 disc + 8 gap.
const DISC_SIDE = 62;
export const PILL_SLOT_MAX = 280;

/**
 * Width of the fixed slot the center pill renders in. iOS native-stack sizes a
 * custom title view from its first layout, before @expo/ui's Host has measured
 * its SwiftUI content — an intrinsically sized pill gets a zero frame and never
 * shows. A fixed slot (pill centered inside) sidesteps that.
 */
export function pillSlotWidth(screenWidth: number): number {
  return Math.max(0, Math.min(screenWidth - 2 * DISC_SIDE, PILL_SLOT_MAX));
}
