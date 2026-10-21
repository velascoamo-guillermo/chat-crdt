#!/usr/bin/env bash
# Builds and installs the Maestro e2e app: release config, JS bundle embedded
# (no Metro at run time), QA readout on, pointed at apps/server on localhost:3001.
#
# Usage:
#   apps/mobile/.maestro/scripts/build-e2e.sh ios <simulator-udid>
#   apps/mobile/.maestro/scripts/build-e2e.sh android <adb-serial>
#
# Rebuild after any native or JS change; run.sh only launches what is installed.
# The env below is the whole config. Shell-provided values win over any .env file
# Expo CLI loads.
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

export CHATCRDT_E2E_BUILD=1
export EXPO_PUBLIC_QA_READOUT=1
export EXPO_PUBLIC_API_URL=http://localhost:3001
export EXPO_PUBLIC_WS_URL=ws://localhost:3001/sync

echo "==> Building workspace packages the app bundle imports"
(cd "$ROOT_DIR/packages/shared" && bun run build)
(cd "$ROOT_DIR/packages/sync-engine" && bun run build)

START=$(date +%s)
cd "$MOBILE_DIR"

if [ "$PLATFORM" = "ios" ]; then
  echo "==> iOS Release build for $DEVICE"
  bunx expo run:ios --configuration Release --no-bundler --device "$DEVICE"
else
  # The e2e prebuild adds a release-only localhost cleartext config
  # (config/withE2eLocalhostCleartext.js). Remove it again however the build
  # ends, so a later production assembleRelease can't pick it up.
  cleanup_android() {
    node -e "require('./config/withE2eLocalhostCleartext').syncE2eReleaseFiles('android/app', {})"
  }
  trap cleanup_android EXIT

  echo "==> Android prebuild (e2e network config)"
  bunx expo prebuild --platform android --no-install
  echo "==> Android release build for $DEVICE"
  # adb reverse lets the app's localhost:3001 reach apps/server on the host.
  adb -s "$DEVICE" reverse tcp:3001 tcp:3001
  bunx expo run:android --variant release --no-bundler --device "$DEVICE"
fi

echo "==> e2e build installed on $DEVICE in $(( $(date +%s) - START ))s"
