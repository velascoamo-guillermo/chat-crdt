// Keeps the chat list bottom-anchored when the floating composer stack changes
// height (typing row, banners, pill↔card). No RN imports — unit-tested with bun.

/**
 * Smallest composer-stack height that counts as a real measurement: the pill
 * alone is ~50pt. Earlier layouts (the wrapper's 8pt margin before the native
 * host has measured) are not settled.
 */
export const SETTLED_COMPOSER_MIN_HEIGHT = 40;

/**
 * Scroll reaction to a composer-stack height change. The first settled
 * measurement snaps to the end (once — `snapped` is the caller's flag): its
 * padding lands after the list rested at the bottom, which would leave the
 * last bubble under the composer. Later changes animate back to the end only
 * if the reader was already there; jitter is ignored.
 */
export function composerResizeScroll({
  atEnd,
  snapped,
  prevHeight,
  nextHeight,
}: {
  atEnd: boolean;
  snapped: boolean;
  prevHeight: number;
  nextHeight: number;
}): 'none' | 'snap' | 'animate' {
  if (!snapped) return nextHeight >= SETTLED_COMPOSER_MIN_HEIGHT ? 'snap' : 'none';
  if (!atEnd || Math.abs(nextHeight - prevHeight) < 1) return 'none';
  return 'animate';
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

export type ScrollMetrics = {
  /** Vertical content offset. */
  offset: number;
  /** Scroll view viewport height. */
  visibleHeight: number;
  /** Content height, excluding the bottom inset. */
  contentHeight: number;
  /** Bottom content inset (keyboard lift + extra padding). */
  bottomInset: number;
};

/** Same pixel tolerance as keyboard-controller's own end check. */
export const AT_END_THRESHOLD = 20;

/**
 * Whether the reader is at the end of the list. keyboard-controller's
 * onEndVisible compares against the content height without the bottom inset,
 * so with the keyboard open a reader scrolled up by less than the keyboard
 * height still counted as "at end" and got yanked down on every composer
 * resize. The end is content + inset.
 */
export function isAtListEnd(m: ScrollMetrics): boolean {
  if (m.visibleHeight <= 0 || m.contentHeight <= 0) return false;
  return m.offset + m.visibleHeight >= m.contentHeight + m.bottomInset - AT_END_THRESHOLD;
}
