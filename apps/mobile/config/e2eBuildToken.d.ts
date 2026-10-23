export const E2E_TOKEN_FILE: string;
export const MIN_TOKEN_LENGTH: number;
export const QA_READOUT_BUNDLE_MARKER: string;
export function readE2eBuildToken(mobileDir: string): string | null;
export function isE2eBuild(
  env: Readonly<Record<string, string | undefined>>,
  token: string | null | undefined,
): boolean;
