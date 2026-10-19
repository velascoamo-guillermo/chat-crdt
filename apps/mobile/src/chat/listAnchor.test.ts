import { describe, it, expect } from 'bun:test';
import { shouldReanchor } from './listAnchor';

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
