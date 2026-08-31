/**
 * Deterministic order digest for the Maestro convergence flow
 * (apps/mobile/.maestro/03-verify-convergence.yaml).
 *
 * Presence-only assertions ("is this text visible") can't tell convergent order
 * from coincidentally-same-length lists — two clients could show the same 5
 * message texts in a different sequence and every `assertVisible` would still
 * pass. This hashes the *order* of rendered content so device A's list and
 * headless client B's final local view can be compared as one opaque string.
 *
 * Used on both sides of the comparison:
 *  - apps/mobile/app/(chat)/index.tsx renders this over the Zustand-projected,
 *    FlashList-rendered `messages` array (what's actually on screen)
 *  - apps/mobile/.maestro/scripts/client-b-offline-inject.ts computes the same
 *    digest over its own post-sync `engine.getMessages()` and prints it for
 *    run.sh to pass into the flow as `-e EXPECTED_ORDER=...`
 *
 * FNV-1a 32-bit — no crypto dependency, identical output in the RN/Hermes app
 * and under plain Node, good enough for an equality check (not a security
 * property).
 */
export function computeOrderDigest(orderedContents: readonly string[]): string {
  const input = orderedContents.join("|");
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
