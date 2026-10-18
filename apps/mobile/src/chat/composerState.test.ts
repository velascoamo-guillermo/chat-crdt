import { describe, it, expect } from 'bun:test';
import {
  composerMode,
  sendButtonState,
  sendButtonVisual,
  e2eeChipLabel,
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
  for (const theme of [chatDarkTheme, chatTheme]) {
    it('ready: accent arrow, enabled, labelled "Up" (Maestro tapOn contract)', () => {
      const v = sendButtonVisual('ready', theme);
      expect(v.a11yLabel).toBe('Up');
      expect(v.icon).toBe('arrow.up');
      expect(v.tint).toBe(theme.accent);
      expect(v.enabled).toBe(true);
    });
    it('empty: arrow, disabled, muted (not accent)', () => {
      const v = sendButtonVisual('empty', theme);
      expect(v.icon).toBe('arrow.up');
      expect(v.enabled).toBe(false);
      expect(v.tint).not.toBe(theme.accent);
    });
    it('gated: lock glyph, disabled, muted, distinct label', () => {
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
