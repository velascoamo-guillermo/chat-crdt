import type { ReactNode } from "react";

/**
 * Pill↔card shell of the composer. Collapsed: `[field, send]` in one row.
 * Expanded: the same row without `send`, plus a toolbar row `[chip, spacer, send]`.
 * `field` stays at a fixed tree index in both modes so it is never remounted
 * (focus, keyboard and native text survive the morph).
 */
export type ComposerSurfaceProps = {
  expanded: boolean;
  field: ReactNode;
  send: ReactNode;
  /** E2EE chip, card toolbar only; null outside E2EE rooms. */
  chip: ReactNode;
  /** Android shell fill + hairline (iOS draws liquid glass instead). */
  surface: string;
  border: string;
};
