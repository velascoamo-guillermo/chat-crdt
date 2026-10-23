import { describe, it, expect } from 'bun:test';
import { composerResizeScroll, shouldFollowNewMessages, isAtListEnd } from './listAnchor';

describe('composerResizeScroll', () => {
  it('animates back to the end when the composer grows while the end is visible (typing row, pill→card)', () => {
    expect(composerResizeScroll({ atEnd: true, snapped: true, prevHeight: 60, nextHeight: 100 })).toBe('animate');
  });
  it('animates back to the end when the composer shrinks while the end is visible (card→pill)', () => {
    expect(composerResizeScroll({ atEnd: true, snapped: true, prevHeight: 100, nextHeight: 60 })).toBe('animate');
  });
  it('leaves the scroll alone when the reader scrolled up into history', () => {
    expect(composerResizeScroll({ atEnd: false, snapped: true, prevHeight: 60, nextHeight: 100 })).toBe('none');
  });
  it('snaps on the first settled measurement even after a margin-only layout (8pt → real height)', () => {
    expect(composerResizeScroll({ atEnd: false, snapped: false, prevHeight: 8, nextHeight: 100 })).toBe('snap');
  });
  it('does not snap on a margin-only first layout', () => {
    expect(composerResizeScroll({ atEnd: false, snapped: false, prevHeight: 0, nextHeight: 8 })).toBe('none');
  });
  it('snaps only once', () => {
    expect(composerResizeScroll({ atEnd: false, snapped: true, prevHeight: 0, nextHeight: 100 })).toBe('none');
  });
  it('ignores sub-pixel layout jitter', () => {
    expect(composerResizeScroll({ atEnd: true, snapped: true, prevHeight: 60, nextHeight: 60.4 })).toBe('none');
  });
});

describe('shouldFollowNewMessages', () => {
  it('follows a message I just sent, even when scrolled up', () => {
    expect(shouldFollowNewMessages({ atEnd: false, prevCount: 3, nextCount: 4, sentByMe: true })).toBe(true);
  });
  it('follows incoming messages while the reader is at the end', () => {
    expect(shouldFollowNewMessages({ atEnd: true, prevCount: 3, nextCount: 5, sentByMe: false })).toBe(true);
  });
  it('leaves a reader browsing history alone on incoming messages', () => {
    expect(shouldFollowNewMessages({ atEnd: false, prevCount: 3, nextCount: 4, sentByMe: false })).toBe(false);
  });
  it('does nothing when no message was added', () => {
    expect(shouldFollowNewMessages({ atEnd: true, prevCount: 4, nextCount: 4, sentByMe: true })).toBe(false);
    expect(shouldFollowNewMessages({ atEnd: true, prevCount: 4, nextCount: 3, sentByMe: false })).toBe(false);
  });
});

describe('isAtListEnd', () => {
  // 2000pt of content in an 800pt viewport. Keyboard open: 300pt bottom inset,
  // so the true end is offset 2000 + 300 - 800 = 1500.
  const keyboardOpen = { visibleHeight: 800, contentHeight: 2000, bottomInset: 300 };

  it('is at the end when scrolled fully down with the keyboard open', () => {
    expect(isAtListEnd({ ...keyboardOpen, offset: 1500 })).toBe(true);
  });
  it('is at the end within the 20pt tolerance', () => {
    expect(isAtListEnd({ ...keyboardOpen, offset: 1485 })).toBe(true);
  });
  it('is NOT at the end when scrolled up 150pt with the keyboard open (less than the keyboard inset)', () => {
    expect(isAtListEnd({ ...keyboardOpen, offset: 1350 })).toBe(false);
  });
  it('keyboard closed: end is content - viewport', () => {
    expect(isAtListEnd({ visibleHeight: 800, contentHeight: 2000, bottomInset: 0, offset: 1200 })).toBe(true);
    expect(isAtListEnd({ visibleHeight: 800, contentHeight: 2000, bottomInset: 0, offset: 1050 })).toBe(false);
  });
  it('is false before the scroll view is measured', () => {
    expect(isAtListEnd({ visibleHeight: 0, contentHeight: 0, bottomInset: 0, offset: 0 })).toBe(false);
  });
});
