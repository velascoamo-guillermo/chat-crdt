// Keeps the chat list bottom-anchored when the floating composer stack changes
// height (typing row, banners, pill↔card). No RN imports — unit-tested with bun.

/**
 * Scroll back to the end after a composer height change only if the reader
 * was already at the end; never on the first measurement or layout jitter.
 */
export function shouldReanchor({
  atEnd,
  prevHeight,
  nextHeight,
}: {
  atEnd: boolean;
  prevHeight: number;
  nextHeight: number;
}): boolean {
  if (!atEnd || prevHeight <= 0) return false;
  return Math.abs(nextHeight - prevHeight) >= 1;
}

/**
 * Scroll to the end after the message count grows: always for my own send
 * (chat convention), otherwise only if the reader was already at the end.
 */
export function shouldFollowNewMessages({
  atEnd,
  prevCount,
  nextCount,
  sentByMe,
}: {
  atEnd: boolean;
  prevCount: number;
  nextCount: number;
  sentByMe: boolean;
}): boolean {
  if (nextCount <= prevCount) return false;
  return sentByMe || atEnd;
}
