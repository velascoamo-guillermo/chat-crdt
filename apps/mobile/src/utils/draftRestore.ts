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
