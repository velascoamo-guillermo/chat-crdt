/**
 * Whether the QA-only chat readout (message count, order digest, ws status)
 * renders. Driven by the build-time EXPO_PUBLIC_QA_READOUT flag alone, so the
 * Maestro e2e build (release config, no Metro) can show it. A production
 * bundle can't carry the flag: config/qaReadoutGuard.js fails that build.
 */
export const isQaReadoutEnabled = (flag: string | undefined): boolean =>
  flag === '1';
