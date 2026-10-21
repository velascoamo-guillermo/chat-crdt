#!/usr/bin/env bash
# Runs the full ticket #13 offline-first Maestro E2E story end to end:
#
#   build @chat-crdt/sync-engine -> reset "default" room -> start server
#   -> provision test users
#   -> [part 1] login + assert "connected" + send 1 ONLINE message
#   -> stop server ("go offline")
#   -> [part 2] assert "disconnected" + send 2 offline messages + kill/relaunch app
#      (SQLite persistence) + assert still "disconnected"
#   -> start server ("restore network")
#   -> headless client B: author 2 offline messages as user B, connect once, ASSERT its
#      own view converged, print an ORDER_DIGEST
#   -> [part 3] assert device A shows all 5 messages, converged, no duplicates, AND in
#      the same order as client B's independently-computed digest
#
# NOTE: these flows are not standalone-reusable in isolation without this script's
# reset-room step — running 01/02/03 directly with `maestro test` against a room that
# already has history from a previous run will fail the exact-count and order-digest
# assertions in part 3 (they're deliberately not "at least these 5 texts").
#
# Prerequisites — install/start these once, this script does NOT do it for you:
#   - maestro CLI: https://maestro.mobile.dev (curl -Ls "https://get.maestro.mobile.dev" | bash)
#   - bun (this is a Bun/Turborepo monorepo) AND a `node` >= 22.6 on PATH — the headless
#     client B script runs under `node --experimental-strip-types`, not bun; see the
#     RED-run finding documented in scripts/client-b-offline-inject.ts (Bun's native
#     WebSocket rejects apps/server's handshake with code 1002, Node's doesn't)
#   - `docker compose -f infra/docker-compose.yml up -d` (postgres + redis)
#   - `bunx prisma migrate deploy` in apps/server (schema up to date)
#   - The e2e app built + installed on the target device (release config, JS bundle
#     embedded, QA readout on, API at localhost:3001). Build once per native or JS
#     change, then run this as often as you like:
#       apps/mobile/.maestro/scripts/build-e2e.sh ios <simulator-udid>
#       apps/mobile/.maestro/scripts/build-e2e.sh android <adb-serial>
#     No Metro needed. The preflight below refuses a debug/dev-client build and a
#     release build without the QA readout, before it touches the server or room.
#
# Usage:
#   apps/mobile/.maestro/run.sh
#   DEVICE_UDID=<simulator-udid|adb-serial> apps/mobile/.maestro/run.sh
#     (needed for Android, and if more than one simulator is booted)
#
# Everything below uses the default server port :3001 and the shared
# infra/docker-compose.yml postgres.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../../.." && pwd)"
SERVER_CTL="$SCRIPT_DIR/scripts/server-ctl.sh"

# Leave apps/server running on exit either way (success: part 3 already needs it up;
# failure: makes ad-hoc post-mortem `curl`/simulator poking possible without first
# having to remember which step left it down). server-ctl.sh start is a no-op if it's
# already up.
cleanup() {
  local exit_code=$?
  if [ $exit_code -ne 0 ]; then
    echo "==> run.sh failed (exit $exit_code) — restoring apps/server for post-mortem" >&2
  fi
  "$SERVER_CTL" start >/dev/null 2>&1 || true
  exit $exit_code
}

RUN_ID="${RUN_ID:-$(date +%s)}"
export RUN_ID
echo "==> RUN_ID=$RUN_ID"

# maestro picks the only booted simulator automatically; with several booted (common in
# dev) it errors asking to disambiguate — set DEVICE_UDID to be explicit.
MAESTRO_DEVICE_ARGS=()
if [ -n "${DEVICE_UDID:-}" ]; then
  MAESTRO_DEVICE_ARGS=(--device "$DEVICE_UDID")
fi

APP_ID="com.chatcrdt.app"
# What build-e2e.sh's bundle carries and no other bundle can (see
# config/e2eBuildToken.js QA_READOUT_BUNDLE_MARKER).
QA_READOUT_MARKER="chatcrdt-qa-readout:1"

# Android = any serial adb knows (emulator or physical device), else iOS.
ADB_SERIALS="$(adb devices 2>/dev/null | awk 'NR > 1 && $2 == "device" { print $1 }' || true)"
IS_ANDROID=0
if [ -n "${DEVICE_UDID:-}" ] && grep -qxF "$DEVICE_UDID" <<<"$ADB_SERIALS"; then
  IS_ANDROID=1
elif [ -z "${DEVICE_UDID:-}" ] && [ -n "$ADB_SERIALS" ] \
  && ! xcrun simctl list devices booted 2>/dev/null | grep -q '(Booted)'; then
  echo "==> Only an Android device is connected: set DEVICE_UDID=<adb-serial>." >&2
  exit 1
fi

not_e2e_build() {
  echo "==> $APP_ID on ${DEVICE_UDID:-the booted simulator} is $1." >&2
  echo "    run.sh needs the e2e build (no Metro). Build it once with:" >&2
  echo "      apps/mobile/.maestro/scripts/build-e2e.sh <ios|android> <device>" >&2
  exit 1
}

echo "==> Preflight: installed app must be the e2e build (embedded bundle with the QA readout, no Metro)"
if [ "$IS_ANDROID" = 1 ]; then
  APK_PATH="$(adb -s "$DEVICE_UDID" shell pm path "$APP_ID" 2>/dev/null | sed -n 's/^package://p' | head -1 | tr -d '\r')"
  [ -n "$APK_PATH" ] || not_e2e_build "not installed"
  # Release builds aren't debuggable; the debug/dev-client build loads JS from Metro.
  # Captured first: `| grep -q` under pipefail can SIGPIPE adb and read a match as "no".
  PKG_DUMP="$(adb -s "$DEVICE_UDID" shell dumpsys package "$APP_ID")"
  if grep -q 'pkgFlags=.*DEBUGGABLE' <<<"$PKG_DUMP"; then
    not_e2e_build "a debug build"
  fi
  APK_COPY="$(mktemp -t chatcrdt-e2e-apk)"
  adb -s "$DEVICE_UDID" pull "$APK_PATH" "$APK_COPY" >/dev/null
  READOUT_HITS="$(unzip -p "$APK_COPY" assets/index.android.bundle | LC_ALL=C grep -a -c "$QA_READOUT_MARKER" || true)"
  rm -f "$APK_COPY"
  [ "${READOUT_HITS:-0}" -gt 0 ] || not_e2e_build "a release build without the QA readout"
  # The release app reaches apps/server at localhost:3001 through this.
  adb -s "$DEVICE_UDID" reverse tcp:3001 tcp:3001 >/dev/null
else
  APP_CONTAINER="$(xcrun simctl get_app_container "${DEVICE_UDID:-booted}" "$APP_ID" app 2>/dev/null)" \
    || not_e2e_build "not installed"
  # Debug builds skip bundling (SKIP_BUNDLING) and load JS from Metro.
  [ -f "$APP_CONTAINER/main.jsbundle" ] || not_e2e_build "a debug build (no embedded main.jsbundle)"
  LC_ALL=C grep -a -q "$QA_READOUT_MARKER" "$APP_CONTAINER/main.jsbundle" \
    || not_e2e_build "a release build without the QA readout"
fi

# From here on, leave apps/server up however the run ends (see cleanup). Not
# before: a failed preflight shouldn't start the server as a side effect.
trap cleanup EXIT

echo "==> Building @chat-crdt/sync-engine (dist/ is gitignored — client B imports it; the app bundle is already built)"
(cd "$ROOT_DIR/packages/sync-engine" && bun run build)

echo "==> Resetting 'default' room for a deterministic message count"
# Terminate the app under test first: a still-running instance holds the old Yjs
# doc in memory and would push it straight back into the freshly reset room when
# the server restarts (flow 01's clearState relaunch comes too late). Any OTHER
# device still in the room must be closed by hand for the same reason.
if [ "$IS_ANDROID" = 1 ]; then
  adb -s "$DEVICE_UDID" shell am force-stop "$APP_ID" || true
else
  xcrun simctl terminate "${DEVICE_UDID:-booted}" "$APP_ID" 2>/dev/null || true
fi
"$SERVER_CTL" stop
"$SERVER_CTL" reset-room

echo "==> Starting apps/server"
"$SERVER_CTL" start

echo "==> Provisioning test users (maestro-a@e2e.test / maestro-b@e2e.test)"
bun "$SCRIPT_DIR/scripts/setup-users.ts"

echo "==> [1/3] Login + send 1 online message"
maestro test "${MAESTRO_DEVICE_ARGS[@]}" "$SCRIPT_DIR/01-login-and-online-message.yaml" -e RUN_ID="$RUN_ID"

echo "==> Going offline: stopping apps/server"
"$SERVER_CTL" stop

echo "==> [2/3] Send 2 offline messages + relaunch app (SQLite persistence check)"
maestro test "${MAESTRO_DEVICE_ARGS[@]}" "$SCRIPT_DIR/02-offline-and-restart.yaml" -e RUN_ID="$RUN_ID"

echo "==> Restoring network: restarting apps/server"
"$SERVER_CTL" start

echo "==> Headless client B: author 2 offline messages, connect once, sync up"
# Captured (not streamed live) so we can pull the ORDER_DIGEST line back out — echoed
# right after so the full transcript still ends up in this script's own output. A
# non-zero exit from client-b-offline-inject.ts (e.g. its own convergence assertion
# failing) fails this assignment under `set -e`, which aborts run.sh here.
CLIENT_B_OUTPUT="$(RUN_ID="$RUN_ID" node --experimental-strip-types "$SCRIPT_DIR/scripts/client-b-offline-inject.ts")"
echo "$CLIENT_B_OUTPUT"

EXPECTED_ORDER="$(echo "$CLIENT_B_OUTPUT" | grep '^ORDER_DIGEST=' | tail -1 | cut -d'=' -f2)"
if [ -z "$EXPECTED_ORDER" ]; then
  echo "==> client-b did not print an ORDER_DIGEST line — see output above" >&2
  exit 1
fi
echo "==> Order digest from client B: $EXPECTED_ORDER"

echo "==> [3/3] Verify convergence on device A (5 messages, no duplicates, matching order)"
maestro test "${MAESTRO_DEVICE_ARGS[@]}" "$SCRIPT_DIR/03-verify-convergence.yaml" \
  -e RUN_ID="$RUN_ID" -e EXPECTED_ORDER="$EXPECTED_ORDER"

echo "==> All 3 Maestro flows passed for RUN_ID=$RUN_ID (order digest $EXPECTED_ORDER)"
