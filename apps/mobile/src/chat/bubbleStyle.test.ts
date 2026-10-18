import { describe, it, expect } from 'bun:test';
import { MUTED_TEXT_OPACITY } from './bubbleStyle';
import { chatTheme, chatDarkTheme } from '../ui/chatTheme';
import { blendOver, contrastRatio } from '../ui/contrast';

// E2EE waiting-for-key / unavailable bubbles render their text at reduced
// opacity on the same bubble — it must stay WCAG AA readable.
describe('muted (E2EE placeholder) bubble text', () => {
  for (const [name, t] of [
    ['dark', chatDarkTheme],
    ['light', chatTheme],
  ] as const) {
    it(`${name}: every author bubble keeps >= 4.5 at MUTED_TEXT_OPACITY`, () => {
      t.authors.forEach((a, i) => {
        const shown = blendOver(a.text, a.bubble, MUTED_TEXT_OPACITY);
        const ratio = contrastRatio(shown, a.bubble);
        if (ratio < 4.5) throw new Error(`${name}[${i}] ${shown} on ${a.bubble} = ${ratio.toFixed(2)}`);
      });
    });

    it(`${name}: own bubble keeps >= 4.5 at MUTED_TEXT_OPACITY`, () => {
      const shown = blendOver(t.textPrimary, t.bubbleOwn, MUTED_TEXT_OPACITY);
      expect(contrastRatio(shown, t.bubbleOwn)).toBeGreaterThanOrEqual(4.5);
    });
  }

  it('is actually muted (below full opacity)', () => {
    expect(MUTED_TEXT_OPACITY).toBeLessThan(1);
    expect(MUTED_TEXT_OPACITY).toBeGreaterThan(0);
  });
});
