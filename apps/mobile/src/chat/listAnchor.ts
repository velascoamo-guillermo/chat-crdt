// Keeps the chat list bottom-anchored when the floating composer stack changes
// height (typing row, banners, pill↔card). No RN imports — unit-tested with bun.

/**
 * Scroll reaction to a composer-stack height change. The first measurement
 * snaps to the end: the padding it adds lands after the list settled at the
 * bottom, which would leave the last bubble under the composer. Later changes
 * animate back to the end only if the reader was already there; jitter is
 * ignored.
 */
export function composerResizeScroll({
  atEnd,
  prevHeight,
  nextHeight,
}: {
  atEnd: boolean;
  prevHeight: number;
  nextHeight: number;
}): 'none' | 'snap' | 'animate' {
  if (prevHeight <= 0) return nextHeight > 0 ? 'snap' : 'none';
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

/**
 * A jump to offset 0 that no drag, momentum or own scroll caused. On iOS
 * Fabric, keyboard-controller moves the list through an animated
 * `contentOffset` prop; the next React commit of the ScrollView carries the
 * default `{0,0}` and RCTScrollViewComponentView applies it (prop diff), so
 * any re-render while the keyboard is open throws a scrolled-up reader to
 * the top. The screen restores the previous offset when this returns true.
 */
export function isSpuriousResetToTop({
  prevOffset,
  nextOffset,
  userScrolling,
}: {
  prevOffset: number;
  nextOffset: number;
  userScrolling: boolean;
}): boolean {
  return !userScrolling && prevOffset > 1 && Math.abs(nextOffset) < 0.5;
}
