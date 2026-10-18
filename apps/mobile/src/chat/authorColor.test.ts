import { describe, it, expect } from 'bun:test';
import { fnv1a32, authorColorIndex, authorColors } from './authorColor';
import { authorPalette, authorPaletteLight } from '../ui/chatTheme';
import { syntheticUserIds } from './__fixtures__/messages';

describe('fnv1a32', () => {
  // Canonical FNV-1a 32-bit vectors (ASCII). If these move, every author on
  // every device gets recolored — that must never happen silently.
  it('matches the published FNV-1a test vectors', () => {
    expect(fnv1a32('')).toBe(0x811c9dc5);
    expect(fnv1a32('a')).toBe(0xe40c292c);
    expect(fnv1a32('foobar')).toBe(0xbf9cf968);
  });

  it('returns an unsigned 32-bit integer', () => {
    for (const id of syntheticUserIds) {
      const h = fnv1a32(id);
      expect(Number.isInteger(h)).toBe(true);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(2 ** 32);
    }
  });
});

describe('authorColorIndex', () => {
  it('is deterministic for the same id', () => {
    for (const id of syntheticUserIds) {
      expect(authorColorIndex(id)).toBe(authorColorIndex(id));
    }
  });

  // Golden table: computed once with an independent FNV-1a (python) and
  // hardcoded. A hash or modulo change that would recolor
  // users on other devices/sessions fails here.
  it('matches the golden userId → index table', () => {
    const golden: Record<string, number> = {
      '': 5,
      a: 4,
      foobar: 0,
      'user-alice': 7,
      'user-bob': 4,
      'user-me': 7,
      '3f2b8c1e-9a4d-4e7b-8c21-5d6f0a1b2c3d': 6,
      ckx7q2m9z0000abcd1234efgh: 7,
    };
    for (const [id, idx] of Object.entries(golden)) {
      expect([id, authorColorIndex(id)]).toEqual([id, idx]);
    }
  });

  it('always lands in [0, 8)', () => {
    for (const id of syntheticUserIds) {
      const i = authorColorIndex(id);
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThan(8);
    }
  });

  it('spreads 200 synthetic ids over all 8 slots, none starved', () => {
    expect(syntheticUserIds).toHaveLength(200);
    const counts = new Array<number>(8).fill(0);
    for (const id of syntheticUserIds) counts[authorColorIndex(id)]++;
    // Expected 25 per slot; allow a wide band, only catch broken hashes.
    for (const c of counts) {
      expect(c).toBeGreaterThanOrEqual(10);
      expect(c).toBeLessThanOrEqual(45);
    }
  });

  it('does not throw on an empty string', () => {
    expect(() => authorColorIndex('')).not.toThrow();
  });
});

describe('authorColors', () => {
  it('picks the palette entry at authorColorIndex', () => {
    for (const id of ['user-alice', 'user-bob', '']) {
      expect(authorColors(id, authorPalette)).toBe(authorPalette[authorColorIndex(id)]);
      expect(authorColors(id, authorPaletteLight)).toBe(authorPaletteLight[authorColorIndex(id)]);
    }
  });

  it('keeps the same slot across dark and light palettes', () => {
    const id = 'user-alice';
    const i = authorColorIndex(id);
    expect(authorColors(id, authorPalette)).toBe(authorPalette[i]);
    expect(authorColors(id, authorPaletteLight)).toBe(authorPaletteLight[i]);
  });
});
