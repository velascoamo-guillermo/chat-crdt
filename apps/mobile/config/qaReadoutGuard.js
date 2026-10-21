// Build guard for the QA-only chat readout (src/qa/qaReadout.ts).
//
// EXPO_PUBLIC_QA_READOUT=1 is inlined into the JS bundle at build time. Only
// the Maestro e2e build (.maestro/scripts/build-e2e.sh) may ship it, and that
// build says so with CHATCRDT_E2E_BUILD=1. Any other production bundle with the
// flag set must fail, not ship the readout.
//
// metro.config.js calls this. Every release bundle goes through Metro in-process
// via Expo CLI: `export:embed --dev false` (Xcode's bundle phase, the RN Gradle
// plugin) or `expo export` (production unless --dev). Plain CJS, no imports:
// metro.config.js requires it and bun tests import it.

/** True when argv is an Expo CLI production bundle command. */
function isProductionBundle(argv) {
  const command = argv.find((arg) => arg === 'export' || arg === 'export:embed');
  if (!command) {
    return false;
  }
  const devIndex = argv.findIndex((arg) => arg === '--dev' || arg.startsWith('--dev='));
  if (devIndex === -1) {
    // export:embed defaults to --dev true; expo export defaults to production.
    return command === 'export';
  }
  const flag = argv[devIndex];
  const value = flag.includes('=') ? flag.split('=')[1] : argv[devIndex + 1];
  // A bare `--dev` (expo export) is followed by another flag or nothing.
  if (value === undefined || value.startsWith('-')) {
    return false;
  }
  return value === 'false';
}

/**
 * The reason this bundle must not be built, or null when it may.
 * @param {{ argv: readonly string[]; env: Readonly<Record<string, string | undefined>> }} input
 * @returns {string | null}
 */
function qaReadoutBuildError({ argv, env }) {
  if (env.EXPO_PUBLIC_QA_READOUT !== '1') {
    return null;
  }
  if (env.CHATCRDT_E2E_BUILD === '1') {
    return null;
  }
  if (!isProductionBundle(argv)) {
    return null;
  }
  return (
    'EXPO_PUBLIC_QA_READOUT=1 is set for a production bundle. The QA readout ' +
    'only ships in the Maestro e2e build (apps/mobile/.maestro/scripts/build-e2e.sh, ' +
    'which sets CHATCRDT_E2E_BUILD=1). Unset EXPO_PUBLIC_QA_READOUT and rebuild.'
  );
}

module.exports = { qaReadoutBuildError };
