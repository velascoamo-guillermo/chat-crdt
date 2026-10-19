export type TextSpan = {
  text: string;
  color: string;
  size: number;
  weight?: "regular" | "semibold";
};

export type SpanTextProps = {
  spans: readonly TextSpan[];
  /** Screen-reader label for the whole line (one focus stop). */
  accessibilityLabel: string;
};
