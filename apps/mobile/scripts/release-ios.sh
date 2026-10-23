#!/usr/bin/env bash
# Builds the iOS staging release and uploads it to TestFlight through the
# rn-workflows-generated fastlane lane (fastlane/Fastfile, `ios staging`).
#
# Usage (from anywhere):
#   TAILSCALE_HOST=<mac>.<tailnet>.ts.net apps/mobile/scripts/release-ios.sh
#       Signed build + TestFlight upload. Needs the signing env (see below).
#   TAILSCALE_HOST=<mac>.<tailnet>.ts.net apps/mobile/scripts/release-ios.sh --check
#       No signing, no upload: prebuild + an unsigned simulator Release
#       compile, then checks the embedded JS bundle carries this host and no
#       QA readout. Needs no secrets.
#
# TAILSCALE_HOST is the bare host name `tailscale serve` exposes (no scheme,
# no path). The build bakes in https://<host> (REST) and wss://<host>/sync
# (Yjs sync), the same paths apps/server serves on :3001.
#
# Signing env for the upload, exported by the caller (never stored in the
# repo): ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_CONTENT (+ ASC_KEY_IS_BASE64),
# APPLE_TEAM_ID, MATCH_PASSWORD, MATCH_GIT_URL. Owner steps:
# .superpowers/sdd/T14-owner-runbook.md (local, not committed).
#
# IOS_BUILD_NUMBER defaults to the current UTC time (yyyymmddHHMM), so every
# upload gets a larger build number than the last (config/releaseIosConfig.js).
set -euo pipefail

MODE="${1:-upload}"
if [[ "$MODE" != "upload" && "$MODE" != "--check" ]]; then
  echo "usage: TAILSCALE_HOST=<host> $0 [--check]" >&2
  exit 2
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MOBILE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ROOT_DIR="$(cd "$MOBILE_DIR/../.." && pwd)"

HOST="${TAILSCALE_HOST:-}"
if [[ ! "$HOST" =~ ^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$ ]]; then
  echo "==> TAILSCALE_HOST must be a bare host name like mac.tailnet.ts.net (got \"$HOST\")." >&2
  exit 2
fi

if [ "$MODE" = "upload" ]; then
  missing=()
  for name in ASC_KEY_ID ASC_ISSUER_ID ASC_KEY_CONTENT APPLE_TEAM_ID MATCH_PASSWORD MATCH_GIT_URL; do
    [ -n "${!name:-}" ] || missing+=("$name")
  done
  if [ ${#missing[@]} -gt 0 ]; then
    echo "==> Missing signing env: ${missing[*]} (see the owner runbook)." >&2
    exit 2
  fi
fi

# The whole build config. EXPO_NO_DOTENV keeps Expo CLI from loading
# apps/mobile/.env*, and the QA readout stays off: config/qaReadoutGuard.js
# fails any production bundle that has it without the e2e token.
export EXPO_NO_DOTENV=1
unset EXPO_PUBLIC_QA_READOUT CHATCRDT_E2E_BUILD
export EXPO_PUBLIC_API_URL="https://$HOST"
export EXPO_PUBLIC_WS_URL="wss://$HOST/sync"
export IOS_BUILD_NUMBER="${IOS_BUILD_NUMBER:-$(date -u +%Y%m%d%H%M)}"

echo "==> Building workspace packages the app bundle imports"
(cd "$ROOT_DIR/packages/shared" && bun run build)
(cd "$ROOT_DIR/packages/sync-engine" && bun run build)

cd "$MOBILE_DIR"

if [ "$MODE" = "--check" ]; then
  echo "==> Prebuild + pod install (ios/ is generated)"
  bunx expo prebuild --platform ios --clean --no-install
  (cd ios && pod install)
  DERIVED="ios/build/check"
  echo "==> Unsigned Release compile for the iOS Simulator (build $IOS_BUILD_NUMBER)"
  xcodebuild -workspace ios/chatcrdt.xcworkspace -scheme chatcrdt -configuration Release \
    -destination 'generic/platform=iOS Simulator' -derivedDataPath "$DERIVED" \
    CODE_SIGNING_ALLOWED=NO -quiet build
  BUNDLE="$DERIVED/Build/Products/Release-iphonesimulator/chatcrdt.app/main.jsbundle"
  LC_ALL=C grep -a -q "https://$HOST" "$BUNDLE" \
    || { echo "==> $BUNDLE does not carry https://$HOST" >&2; exit 1; }
  LC_ALL=C grep -a -q "wss://$HOST/sync" "$BUNDLE" \
    || { echo "==> $BUNDLE does not carry wss://$HOST/sync" >&2; exit 1; }
  if LC_ALL=C grep -a -q "chatcrdt-qa-readout:1" "$BUNDLE"; then
    echo "==> $BUNDLE carries the QA readout" >&2
    exit 1
  fi
  echo "==> Check passed: Release bundle points at $HOST, no QA readout"
  exit 0
fi

# rn-workflows picks the package manager from a lockfile in the app directory
# only. This monorepo's bun.lock is at the root, so the generated lane runs
# `yarn expo prebuild`, which yarn refuses here (root packageManager is bun).
# Route that one call to bun until rn-workflows also looks at the git root.
SHIM_DIR="$(mktemp -d -t chatcrdt-release)"
trap 'rm -rf "$SHIM_DIR"' EXIT
printf '#!/bin/sh\nexec bun "$@"\n' > "$SHIM_DIR/yarn"
chmod +x "$SHIM_DIR/yarn"
export PATH="$SHIM_DIR:$PATH"

bundle check >/dev/null 2>&1 || bundle install
echo "==> fastlane ios staging (build $IOS_BUILD_NUMBER, server $HOST)"
bundle exec fastlane ios staging
