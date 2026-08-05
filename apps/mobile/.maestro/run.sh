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
#   - Mobile app built + installed on an iOS simulator, with the udid booted
#     (`cd apps/mobile && bun run ios`, or `expo run:ios` once, then keep the
#     simulator booted — this script only launches/relaunches, never (re)builds)
#   - Metro running for that app WITH the QA readout flag set ([roomId].tsx gates
#     chat-message-count/chat-order-digest/chat-ws-status behind it, off by default —
#     see the review-round-1 note there), e.g.:
#       cd apps/mobile && EXPO_PUBLIC_QA_READOUT=1 bun run dev
#     (EXPO_PUBLIC_API_URL / EXPO_PUBLIC_WS_URL must also point at a host the simulator
#     can actually reach — plain `localhost` works for the iOS simulator, which shares
#     the host Mac's network namespace; a stale LAN IP in apps/mobile/.env will hang
#     every request. Override at Metro start time, same as EXPO_PUBLIC_QA_READOUT.)
#
# Usage:
#   apps/mobile/.maestro/run.sh
#   DEVICE_UDID=<simulator-udid> apps/mobile/.maestro/run.sh   # if more than one
#                                                               # simulator is booted
#
# Everything below uses default ports (server :3001, Metro :8081) and the shared
# infra/docker-compose.yml postgres — this ticket's lane per the amendment in #13.
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
trap cleanup EXIT

RUN_ID="${RUN_ID:-$(date +%s)}"
export RUN_ID
echo "==> RUN_ID=$RUN_ID"

# maestro picks the only booted simulator automatically; with several booted (common in
# dev) it errors asking to disambiguate — set DEVICE_UDID to be explicit.
MAESTRO_DEVICE_ARGS=()
if [ -n "${DEVICE_UDID:-}" ]; then
  MAESTRO_DEVICE_ARGS=(--device "$DEVICE_UDID")
fi

echo "==> Building @chat-crdt/sync-engine (dist/ is gitignored — needed by both the app bundle and client B on a clean clone)"
(cd "$ROOT_DIR/packages/sync-engine" && bun run build)

echo "==> Resetting 'default' room for a deterministic message count"
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
