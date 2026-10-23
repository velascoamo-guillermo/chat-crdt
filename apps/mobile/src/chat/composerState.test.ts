import { describe, it, expect } from 'bun:test';
import {
  composerMode,
  sendButtonState,
  sendButtonVisual,
  e2eeChipLabel,
  composerHeightStep,
} from './composerState';
import { chatDarkTheme, chatTheme } from '../ui/chatTheme';

describe('composerMode', () => {
  it.each([
    [false, false, 'pill'],
    [true, false, 'card'],
    [false, true, 'card'],
    [true, true, 'card'],
  ] as const)('focused=%p hasDraft=%p → %s', (focused, hasDraft, mode) => {
    expect(composerMode({ focused, hasDraft })).toBe(mode);
  });
});

describe('composerHeightStep (Android height wrapper)', () => {
  it('jumps to the first measurement without animating', () => {
    expect(composerHeightStep(null, 52)).toEqual({ height: 52, animate: false });
  });
  it('animates to a new measured height', () => {
    expect(composerHeightStep(52, 104)).toEqual({ height: 104, animate: true });
  });
  it('ignores sub-pixel jitter', () => {
    expect(composerHeightStep(104, 104.4)).toBeNull();
  });
  it('ignores empty or invalid measurements (unmounting / not laid out yet)', () => {
    expect(composerHeightStep(104, 0)).toBeNull();
    expect(composerHeightStep(null, 0)).toBeNull();
    expect(composerHeightStep(104, Number.NaN)).toBeNull();
  });
});

describe('sendButtonState', () => {
  it('gated wins over text', () => {
    expect(sendButtonState({ hasText: true, gated: true })).toBe('gated');
  });
  it('gated with empty draft is gated', () => {
    expect(sendButtonState({ hasText: false, gated: true })).toBe('gated');
  });
  it('text and not gated is ready', () => {
    expect(sendButtonState({ hasText: true, gated: false })).toBe('ready');
  });
  it('empty and not gated is empty', () => {
    expect(sendButtonState({ hasText: false, gated: false })).toBe('empty');
  });
});

describe('sendButtonVisual', () => {
  for (const [name, theme] of [['dark', chatDarkTheme], ['light', chatTheme]] as const) {
    it(`${name} ready: accent arrow, enabled, labelled "Up" (Maestro tapOn contract)`, () => {
      const v = sendButtonVisual('ready', theme);
      expect(v.a11yLabel).toBe('Up');
      expect(v.icon).toBe('arrow.up');
      expect(v.tint).toBe(theme.accent);
      expect(v.enabled).toBe(true);
    });
    it(`${name} empty: arrow, disabled, muted (not accent), still labelled "Up"`, () => {
      const v = sendButtonVisual('empty', theme);
      expect(v.a11yLabel).toBe('Up');
      expect(v.icon).toBe('arrow.up');
      expect(v.enabled).toBe(false);
      expect(v.tint).not.toBe(theme.accent);
    });
    it(`${name} gated: lock glyph, disabled, muted, distinct label`, () => {
      const v = sendButtonVisual('gated', theme);
      expect(v.icon).toBe('lock.fill');
      expect(v.enabled).toBe(false);
      expect(v.tint).not.toBe(theme.accent);
      expect(v.a11yLabel).not.toBe('Up');
    });
  }
});

describe('e2eeChipLabel', () => {
  it('shows "Encrypted" for E2EE rooms', () => {
    expect(e2eeChipLabel(true)).toBe('Encrypted');
  });
  it('is null otherwise', () => {
    expect(e2eeChipLabel(false)).toBeNull();
  });
});
