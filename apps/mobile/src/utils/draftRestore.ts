/**
 * T10: the composer draft after the server refused some of this user's
 * text. Each rejection (`seq`) applies once and appends to whatever is being
 * typed; an empty restore (nothing recoverable) only marks it seen. Null =
 * leave the draft alone.
 */
export function draftAfterRestore(
  current: string,
  restore: { text: string; seq: number } | undefined,
  lastSeq: number | null,
): { draft: string; seq: number } | null {
  if (!restore || restore.seq === lastSeq) return null;
  if (!restore.text) return { draft: current, seq: restore.seq };
  const typed = current.trim();
  return { draft: typed ? `${typed}\n${restore.text}` : restore.text, seq: restore.seq };
}

/** The composer state a restore writes to (native draft + the React `hasText` flag). */
export interface DraftRestoreTarget {
  getDraft(): string;
  setDraft(value: string): void;
  hasText(): boolean;
  setHasText(active: boolean): void;
}

/**
 * Applies a restore to the composer. Writing the draft programmatically
 * doesn't fire onChangeText, so `hasText` (which drives Send and the card)
 * is synced here too. Returns the seq now applied, or null if nothing changed.
 */
export function applyDraftRestore(
  target: DraftRestoreTarget,
  restore: { text: string; seq: number } | undefined,
  lastSeq: number | null,
): number | null {
  const next = draftAfterRestore(target.getDraft(), restore, lastSeq);
  if (!next) return null;
  if (next.draft !== target.getDraft()) target.setDraft(next.draft);
  const active = next.draft.trim().length > 0;
  if (active !== target.hasText()) target.setHasText(active);
  return next.seq;
}
