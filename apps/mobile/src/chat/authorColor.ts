// Stable per-author tint (spec goal 4): hash userId → palette slot. Must be
// identical on every device and session, so no Math.random and no platform
// APIs — plain FNV-1a over UTF-16 code units (equals the byte-wise FNV-1a for
// ASCII ids, which is what the golden vectors pin).
import type { AuthorColors } from '../ui/chatTheme';

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;
const SLOTS = 8;

export function fnv1a32(input: string): number {
  let hash = FNV_OFFSET;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME);
  }
  return hash >>> 0;
}

export function authorColorIndex(userId: string): number {
  return fnv1a32(userId) % SLOTS;
}

export function authorColors(userId: string, palette: readonly AuthorColors[]): AuthorColors {
  return palette[authorColorIndex(userId) % palette.length];
}
