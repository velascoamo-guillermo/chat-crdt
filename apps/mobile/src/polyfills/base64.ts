// Guarded base64 polyfill. Hermes (RN 0.74+) ships global atob/btoa, but the
// sync-engine (SQLitePersistence, WebSocketProvider) depends on them and JSC /
// older engines do not. Install a correct latin1 implementation only when the
// globals are missing so we never crash and never override a native impl.

const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const LOOKUP: Record<string, number> = {};
for (let i = 0; i < CHARS.length; i++) LOOKUP[CHARS[i]] = i;

/** Encode a latin1/binary string (char codes 0–255) to base64. */
function polyBtoa(input: string): string {
  let output = '';
  for (let i = 0; i < input.length; i += 3) {
    const c0 = input.charCodeAt(i);
    const c1 = i + 1 < input.length ? input.charCodeAt(i + 1) : NaN;
    const c2 = i + 2 < input.length ? input.charCodeAt(i + 2) : NaN;
    if (c0 > 0xff || c1 > 0xff || c2 > 0xff) {
      throw new Error('btoa: input contains characters outside the Latin1 range');
    }
    const triplet = (c0 << 16) | ((Number.isNaN(c1) ? 0 : c1) << 8) | (Number.isNaN(c2) ? 0 : c2);
    output += CHARS[(triplet >> 18) & 0x3f];
    output += CHARS[(triplet >> 12) & 0x3f];
    output += Number.isNaN(c1) ? '=' : CHARS[(triplet >> 6) & 0x3f];
    output += Number.isNaN(c2) ? '=' : CHARS[triplet & 0x3f];
  }
  return output;
}

/** Decode base64 back to a latin1/binary string. */
function polyAtob(input: string): string {
  const str = input.replace(/[^A-Za-z0-9+/]/g, '');
  let output = '';
  for (let i = 0; i < str.length; i += 4) {
    const e0 = LOOKUP[str[i]];
    const e1 = LOOKUP[str[i + 1]];
    const e2 = LOOKUP[str[i + 2]];
    const e3 = LOOKUP[str[i + 3]];
    const triplet = (e0 << 18) | (e1 << 12) | ((e2 ?? 0) << 6) | (e3 ?? 0);
    output += String.fromCharCode((triplet >> 16) & 0xff);
    if (e2 !== undefined) output += String.fromCharCode((triplet >> 8) & 0xff);
    if (e3 !== undefined) output += String.fromCharCode(triplet & 0xff);
  }
  return output;
}

const g = globalThis as typeof globalThis & {
  btoa?: (input: string) => string;
  atob?: (input: string) => string;
};

if (typeof g.btoa !== 'function') g.btoa = polyBtoa;
if (typeof g.atob !== 'function') g.atob = polyAtob;
