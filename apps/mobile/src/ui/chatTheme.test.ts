import { describe, it, expect } from 'bun:test';
import {
  chatColors,
  chatTheme,
  chatDarkTheme,
  authorPalette,
  authorPaletteLight,
  type ChatTheme,
} from './chatTheme';
import { contrastRatio } from './contrast';
import { theme, darkTheme } from './theme';

const COLOR_KEYS = [
  'bg',
  'surface',
  'surfaceRaised',
  'bubbleOwn',
  'textPrimary',
  'textSecondary',
  'placeholder',
  'border',
  'accent',
  'accentOn',
] as const;

const HEX = /^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

function expectComplete(t: ChatTheme): void {
  for (const k of COLOR_KEYS) expect(t[k]).toMatch(HEX);
  expect(t.glassFallback.fill).toMatch(HEX);
  expect(t.glassFallback.border).toMatch(HEX);
  expect(t.status.connected).toMatch(HEX);
  expect(t.status.connecting).toMatch(HEX);
  expect(t.status.offline).toMatch(HEX);
  for (const r of ['sm', 'md', 'lg', 'bubble', 'pill'] as const) {
    expect(typeof t.radius[r]).toBe('number');
  }
  expect(t.authors).toHaveLength(8);
}

describe('chatColors(scheme)', () => {
  it('returns the dark palette for "dark"', () => {
    expect(chatColors('dark')).toBe(chatDarkTheme);
  });

  it('returns the light palette for "light"', () => {
    expect(chatColors('light')).toBe(chatTheme);
  });

  it('falls back to light for null / undefined / "unspecified"', () => {
    expect(chatColors(null)).toBe(chatTheme);
    expect(chatColors(undefined)).toBe(chatTheme);
    expect(chatColors('unspecified')).toBe(chatTheme);
  });

  it('both palettes are complete', () => {
    expectComplete(chatTheme);
    expectComplete(chatDarkTheme);
  });

  it('dark and light palettes are distinct on the surface colors', () => {
    for (const k of ['bg', 'surface', 'surfaceRaised', 'bubbleOwn', 'textPrimary'] as const) {
      expect(chatDarkTheme[k].toLowerCase()).not.toBe(chatTheme[k].toLowerCase());
    }
  });

  it('dark canvas is a warm near-black (red channel >= blue, low luminance)', () => {
    const bg = chatDarkTheme.bg.slice(1);
    const r = parseInt(bg.slice(0, 2), 16);
    const b = parseInt(bg.slice(4, 6), 16);
    expect(r).toBeGreaterThanOrEqual(b);
    expect(r).toBeLessThan(0x30);
  });

  it('palettes carry the matching author palette', () => {
    expect(chatDarkTheme.authors).toBe(authorPalette);
    expect(chatTheme.authors).toBe(authorPaletteLight);
  });
});

describe('author palettes', () => {
  const cases = [
    ['dark', authorPalette],
    ['light', authorPaletteLight],
  ] as const;

  for (const [name, palette] of cases) {
    it(`${name}: has exactly 8 entries`, () => {
      expect(palette).toHaveLength(8);
    });

    it(`${name}: has no duplicate bubble colors`, () => {
      const bubbles = palette.map((a) => a.bubble.toLowerCase());
      expect(new Set(bubbles).size).toBe(bubbles.length);
    });

    it(`${name}: every author text reaches WCAG AA (>= 4.5) on its bubble`, () => {
      palette.forEach((a, i) => {
        const ratio = contrastRatio(a.text, a.bubble);
        if (ratio < 4.5) throw new Error(`${name}[${i}] text ${a.text} on ${a.bubble} = ${ratio.toFixed(2)}`);
      });
    });

    it(`${name}: every author name reaches WCAG AA (>= 4.5) on the canvas`, () => {
      const bg = name === 'dark' ? chatDarkTheme.bg : chatTheme.bg;
      palette.forEach((a, i) => {
        const ratio = contrastRatio(a.name, bg);
        if (ratio < 4.5) throw new Error(`${name}[${i}] name ${a.name} on ${bg} = ${ratio.toFixed(2)}`);
      });
    });
  }
});

describe('chat theme contrast', () => {
  for (const [name, t] of [
    ['dark', chatDarkTheme],
    ['light', chatTheme],
  ] as const) {
    it(`${name}: textPrimary on bubbleOwn >= 4.5`, () => {
      expect(contrastRatio(t.textPrimary, t.bubbleOwn)).toBeGreaterThanOrEqual(4.5);
    });

    it(`${name}: textPrimary on bg >= 4.5`, () => {
      expect(contrastRatio(t.textPrimary, t.bg)).toBeGreaterThanOrEqual(4.5);
    });

    it(`${name}: accentOn (send arrow) on accent >= 3 (non-text UI)`, () => {
      expect(contrastRatio(t.accentOn, t.accent)).toBeGreaterThanOrEqual(3);
    });
  }
});

describe('global theme untouched (rooms/account/auth keep current palette)', () => {
  it('light theme keys unchanged', () => {
    expect({ accent: theme.accent, bg: theme.bg, surface: theme.surface, textPrimary: theme.textPrimary, border: theme.border }).toEqual({
      accent: '#0066ff',
      bg: '#ffffff',
      surface: '#f0f0f0',
      textPrimary: '#111111',
      border: '#eeeeee',
    });
  });

  it('dark theme keys unchanged', () => {
    expect({ accent: darkTheme.accent, bg: darkTheme.bg, surface: darkTheme.surface, textPrimary: darkTheme.textPrimary, border: darkTheme.border }).toEqual({
      accent: '#0066ff',
      bg: '#0a0a0a',
      surface: '#1c1c1e',
      textPrimary: '#ffffff',
      border: '#2c2c2e',
    });
  });
});
