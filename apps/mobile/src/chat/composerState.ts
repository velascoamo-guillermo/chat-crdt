// Pure composer derivations (spec goal 6). No RN imports — unit-tested with bun.
import type { ChatTheme } from '../ui/chatTheme';

export type ComposerMode = 'pill' | 'card';
export type SendButtonState = 'empty' | 'ready' | 'gated';

export type SendButtonVisual = {
  /** SF Symbol name; Composer maps it to the Android Material Symbol. */
  icon: 'arrow.up' | 'lock.fill';
  tint: string;
  enabled: boolean;
  a11yLabel: string;
};

/** Card while focused or holding a draft; pill only when blurred and empty. */
export function composerMode({ focused, hasDraft }: { focused: boolean; hasDraft: boolean }): ComposerMode {
  return focused || hasDraft ? 'card' : 'pill';
}

/** Gated (E2EE key not loaded) wins over having text. */
export function sendButtonState({ hasText, gated }: { hasText: boolean; gated: boolean }): SendButtonState {
  if (gated) return 'gated';
  return hasText ? 'ready' : 'empty';
}

export function sendButtonVisual(state: SendButtonState, theme: ChatTheme): SendButtonVisual {
  switch (state) {
    case 'ready':
      // "Up" is the Maestro tapOn target (flows 01/02) — keep it stable.
      return { icon: 'arrow.up', tint: theme.accent, enabled: true, a11yLabel: 'Up' };
    case 'empty':
      return { icon: 'arrow.up', tint: theme.surfaceRaised, enabled: false, a11yLabel: 'Up' };
    case 'gated':
      return { icon: 'lock.fill', tint: theme.surfaceRaised, enabled: false, a11yLabel: 'Send locked' };
  }
}

export function e2eeChipLabel(encrypted: boolean): string | null {
  return encrypted ? 'Encrypted' : null;
}

/**
 * Next step for the Android composer height wrapper, given the last applied
 * height and a new measurement of the Compose content. First measurement
 * snaps (nothing to animate from); empty/invalid or sub-pixel changes are
 * ignored (null) so unmount and layout jitter never start a spring.
 */
export function composerHeightStep(
  prev: number | null,
  measured: number,
): { height: number; animate: boolean } | null {
  if (!Number.isFinite(measured) || measured <= 0) return null;
  if (prev === null) return { height: measured, animate: false };
  if (Math.abs(measured - prev) < 1) return null;
  return { height: measured, animate: true };
}
