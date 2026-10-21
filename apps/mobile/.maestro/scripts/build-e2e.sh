#!/usr/bin/env bash
# Builds and installs the Maestro e2e app: release config, JS bundle embedded
# (no Metro at run time), QA readout on, pointed at apps/server on localhost:3001.
#
# Usage:
#   apps/mobile/.maestro/scripts/build-e2e.sh ios <simulator-udid>
#   apps/mobile/.maestro/scripts/build-e2e.sh android <adb-serial>
#
# Use the headless e2e devices (see run.sh). The iOS path never opens
# Simulator.app and doesn't launch the app.
#
# Rebuild after any native or JS change; run.sh only launches what is installed.
# The env below is the whole config. EXPO_NO_DOTENV keeps Expo CLI from loading
# apps/mobile/.env*, and CHATCRDT_E2E_BUILD is a per-run token (see
# config/e2eBuildToken.js), so no .env value can make a normal build an e2e one.
set -euo pipefail

PLATFORM="${1:-}"
DEVICE="${2:-}"
if [[ "$PLATFORM" != "ios" && "$PLATFORM" != "android" ]] || [ -z "$DEVICE" ]; then
  echo "usage: $0 <ios|android> <simulator-udid|adb-serial>" >&2
  exit 2
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MOBILE_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
ROOT_DIR="$(cd "$MOBILE_DIR/../.." && pwd)"

E2E_TOKEN_FILE="$MOBILE_DIR/.e2e-build-token"
E2E_TOKEN="$(uuidgen)"
export EXPO_NO_DOTENV=1
export CHATCRDT_E2E_BUILD="$E2E_TOKEN"
export EXPO_PUBLIC_QA_READOUT=1
export EXPO_PUBLIC_API_URL=http://localhost:3001
export EXPO_PUBLIC_WS_URL=ws://localhost:3001/sync

echo "==> Building workspace packages the app bundle imports"
(cd "$ROOT_DIR/packages/shared" && bun run build)
(cd "$ROOT_DIR/packages/sync-engine" && bun run build)

START=$(date +%s)
cd "$MOBILE_DIR"

# However the build ends: drop the token, and on Android everything a later
# production assembleRelease could reuse. That's the release-only localhost
# cleartext config (config/withE2eLocalhostCleartext.js) and the e2e JS bundle
# with the outputs packaged from it (the APK is already installed). Gradle's
# bundle task also re-bundles when the QA flag or token changes, and fails a
# non-e2e release that carries the readout (config/withQaReadoutBundleCheck.js);
# deleting the outputs here means neither of those has to be the only guard.
cleanup() {
  rm -f "$E2E_TOKEN_FILE"
  if [ "$PLATFORM" = "android" ]; then
    node -e "require('./config/withE2eLocalhostCleartext').syncE2eReleaseFiles('android/app', {}, null)"
    find android/app/src/release -type d -empty -delete 2>/dev/null || true
    local build="android/app/build"
    rm -rf "$build/generated/assets/react/release" "$build/generated/res/react/release" \
      "$build/generated/sourcemaps/react/release" "$build/intermediates/sourcemaps/react/release" \
      "$build/intermediates/assets/release" "$build/intermediates/compressed_assets/release" \
      "$build/outputs/apk/release"
  fi
}
trap cleanup EXIT
echo "$E2E_TOKEN" > "$E2E_TOKEN_FILE"

if [ "$PLATFORM" = "ios" ]; then
  # xcodebuild + simctl install, not `expo run:ios`: that launches the app and
  # opens Simulator.app when no simulator UI is running, and e2e devices stay
  # headless (run.sh launches the app through Maestro).
  echo "==> iOS Release build for $DEVICE"
  XCODE_ARGS=(-workspace ios/chatcrdt.xcworkspace -scheme chatcrdt -configuration Release
    -destination "id=$DEVICE")
  xcodebuild "${XCODE_ARGS[@]}" -quiet build
  PRODUCTS_DIR="$(xcodebuild "${XCODE_ARGS[@]}" -showBuildSettings 2>/dev/null \
    | awk -F' = ' '/^ *BUILT_PRODUCTS_DIR = / { print $2; exit }')"
  echo "==> Installing $PRODUCTS_DIR/chatcrdt.app on $DEVICE"
  xcrun simctl install "$DEVICE" "$PRODUCTS_DIR/chatcrdt.app"
else
  echo "==> Android prebuild (e2e network config)"
  bunx expo prebuild --platform android --no-install
  echo "==> Android release build for $DEVICE"
  # adb reverse lets the app's localhost:3001 reach apps/server on the host.
  adb -s "$DEVICE" reverse tcp:3001 tcp:3001
  bunx expo run:android --variant release --no-bundler --device "$DEVICE"
fi

echo "==> e2e build installed on $DEVICE in $(( $(date +%s) - START ))s"
