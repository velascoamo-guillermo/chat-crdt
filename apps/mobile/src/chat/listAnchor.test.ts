import { describe, it, expect } from 'bun:test';
import { shouldReanchor, shouldFollowNewMessages } from './listAnchor';

describe('shouldReanchor', () => {
  it('re-anchors when the composer grows while the end is visible (typing row, pill→card)', () => {
    expect(shouldReanchor({ atEnd: true, prevHeight: 60, nextHeight: 100 })).toBe(true);
  });
  it('re-anchors when the composer shrinks while the end is visible (card→pill)', () => {
    expect(shouldReanchor({ atEnd: true, prevHeight: 100, nextHeight: 60 })).toBe(true);
  });
  it('leaves the scroll alone when the reader scrolled up into history', () => {
    expect(shouldReanchor({ atEnd: false, prevHeight: 60, nextHeight: 100 })).toBe(false);
  });
  it('ignores the first measurement (initial render already starts at the bottom)', () => {
    expect(shouldReanchor({ atEnd: true, prevHeight: 0, nextHeight: 60 })).toBe(false);
  });
  it('ignores sub-pixel layout jitter', () => {
    expect(shouldReanchor({ atEnd: true, prevHeight: 60, nextHeight: 60.4 })).toBe(false);
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
