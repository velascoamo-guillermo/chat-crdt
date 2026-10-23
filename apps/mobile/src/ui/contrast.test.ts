import { describe, it, expect } from 'bun:test';
import { relativeLuminance, contrastRatio, blendOver } from './contrast';

describe('relativeLuminance (WCAG 2.x)', () => {
  it('is 0 for black and 1 for white', () => {
    expect(relativeLuminance('#000000')).toBe(0);
    expect(relativeLuminance('#ffffff')).toBe(1);
  });

  it('accepts 3-digit shorthand and is case-insensitive', () => {
    expect(relativeLuminance('#FFF')).toBe(1);
    expect(relativeLuminance('#AbCdEf')).toBeCloseTo(relativeLuminance('#abcdef'), 10);
  });

  it('accepts 8-digit #RRGGBBAA and ignores alpha (glassFallback tokens)', () => {
    expect(relativeLuminance('#FFFFFF1F')).toBe(1);
    expect(relativeLuminance('#00000080')).toBe(0);
  });

  it('throws on malformed input instead of silently returning a number', () => {
    expect(() => relativeLuminance('red')).toThrow();
    expect(() => relativeLuminance('#12345')).toThrow();
  });
});

describe('contrastRatio (WCAG 2.x)', () => {
  it('is 21 for black on white, in either order', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 5);
  });

  it('is 1 for the same color', () => {
    expect(contrastRatio('#D97757', '#d97757')).toBeCloseTo(1, 10);
  });

  it('is ~4.48 for #777777 on white (classic just-below-AA vector)', () => {
    expect(contrastRatio('#777777', '#ffffff')).toBeCloseTo(4.48, 2);
  });
});

describe('blendOver (alpha composite)', () => {
  it('returns the background at alpha 0 and the foreground at alpha 1', () => {
    expect(blendOver('#ffffff', '#000000', 0)).toBe('#000000');
    expect(blendOver('#ffffff', '#000000', 1)).toBe('#ffffff');
  });

  it('mixes channels linearly in sRGB (what RN opacity renders)', () => {
    expect(blendOver('#ffffff', '#000000', 0.5)).toBe('#808080');
    expect(blendOver('#F5F4EF', '#4A2C2A', 0.7)).toBe('#c2b8b4');
  });
});
