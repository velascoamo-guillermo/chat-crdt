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

export function truncateLabel(label: string, maxChars: number): string {
  return label.length <= maxChars ? label : `${label.slice(0, maxChars - 1)}…`;
}

// Pill chrome around the room name: 2×12 horizontal padding + the
// " · ● 99 online" status run (~100pt at 13pt). Room name is 15pt semibold,
// ~8.6pt per glyph for [a-z0-9-]. Estimates — the native text also tail-truncates
// as a backstop, but that would eat the status run first, hence this budget.
const PILL_CHROME = 124;
const ROOM_CHAR_W = 8.6;
const MIN_ROOM_CHARS = 6;

/** Max chars of the room label (incl. "# ") that fit in a pill slot of `slotWidth`. */
export function roomCharBudget(slotWidth: number): number {
  return Math.max(MIN_ROOM_CHARS, Math.floor((slotWidth - PILL_CHROME) / ROOM_CHAR_W));
}

/** Room label as shown in the pill: truncated with "…" so the status run always fits. */
export function pillRoomLabel(roomId: string, slotWidth: number): string {
  return truncateLabel(roomLabel(roomId), roomCharBudget(slotWidth));
}
