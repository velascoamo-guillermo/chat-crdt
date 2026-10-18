// Message grouping (spec goal 4): consecutive messages from one author form a
// group; the author name shows once above it. A pause longer than the gap
// also starts a new group, so a conversation resumed later re-labels itself.
import type { MessageDto } from '@chat-crdt/shared';

export const GROUP_GAP_MS = 5 * 60_000;

export type GroupPosition = {
  /** Render the author name above this bubble (never for own messages). */
  showAuthor: boolean;
  isFirst: boolean;
  isLast: boolean;
};

function sameGroup(a: MessageDto, b: MessageDto, gapMs: number): boolean {
  return a.userId === b.userId && Math.abs(b.createdAt - a.createdAt) <= gapMs;
}

export function groupPosition(
  prev: MessageDto | undefined,
  curr: MessageDto,
  next: MessageDto | undefined,
  gapMs: number = GROUP_GAP_MS,
  myUserId?: string,
): GroupPosition {
  const isFirst = !prev || !sameGroup(prev, curr, gapMs);
  const isLast = !next || !sameGroup(curr, next, gapMs);
  return { showAuthor: isFirst && curr.userId !== myUserId, isFirst, isLast };
}
