// Who counts as the Maestro e2e build, for the QA readout guard and the e2e
// config plugins.
//
// build-e2e.sh exports CHATCRDT_E2E_BUILD=<random token> and writes the same
// token to apps/mobile/.e2e-build-token for the length of the build, then
// deletes it. A static value (say CHATCRDT_E2E_BUILD=1 in a .env that Expo CLI
// loads) can't match a fresh token, so it can't turn a normal build into an e2e
// one. Plain CJS, no imports beyond node: the guard, the plugins and bun tests
// all require it.

/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs');
const path = require('path');

const E2E_TOKEN_FILE = '.e2e-build-token';
const MIN_TOKEN_LENGTH = 16;

// What app/(chat)/[roomId].tsx folds to in a bundle built with
// EXPO_PUBLIC_QA_READOUT=1. App code must never spell it out in full, or
// every bundle would carry it.
const QA_READOUT_BUNDLE_MARKER = 'chatcrdt-qa-readout:1';

/**
 * The token of the e2e build in progress, or null.
 * @param {string} mobileDir apps/mobile
 * @returns {string | null}
 */
function readE2eBuildToken(mobileDir) {
  const file = path.join(mobileDir, E2E_TOKEN_FILE);
  if (!fs.existsSync(file)) {
    return null;
  }
  return fs.readFileSync(file, 'utf8').trim() || null;
}

/**
 * True only for the e2e build: the env value matches the per-run token.
 * @param {Readonly<Record<string, string | undefined>>} env
 * @param {string | null | undefined} token
 * @returns {boolean}
 */
function isE2eBuild(env, token) {
  if (!token || token.length < MIN_TOKEN_LENGTH) {
    return false;
  }
  return env.CHATCRDT_E2E_BUILD === token;
}

module.exports = {
  E2E_TOKEN_FILE,
  MIN_TOKEN_LENGTH,
  QA_READOUT_BUNDLE_MARKER,
  readE2eBuildToken,
  isE2eBuild,
};
