// WCAG 2.x relative luminance + contrast ratio. Pure — used by the chat
// palette tests to guarantee author bubbles stay legible (AA ≥ 4.5).

function parseHex(hex: string): [number, number, number] {
  // Alpha (#RRGGBBAA) is ignored: contrast is computed on the opaque color.
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.length === 9 ? hex.slice(0, 7) : hex);
  if (!m) throw new Error(`Invalid hex color: ${hex}`);
  const h = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

function channel(c8: number): number {
  const c = c8 / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex: string): number {
  const [r, g, b] = parseHex(hex).map(channel);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Composite `fg` at `alpha` over opaque `bg` (sRGB, like RN `opacity`). */
export function blendOver(fg: string, bg: string, alpha: number): string {
  const f = parseHex(fg);
  const b = parseHex(bg);
  return (
    '#' +
    f
      .map((c, i) => Math.round(c * alpha + b[i] * (1 - alpha)).toString(16).padStart(2, '0'))
      .join('')
  );
}
