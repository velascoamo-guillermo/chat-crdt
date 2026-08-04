#!/usr/bin/env bash
# Runs the full ticket #13 offline-first Maestro E2E story end to end:
#
#   reset "default" room -> start server -> provision test users
#   -> [part 1] login + send 1 ONLINE message
#   -> stop server ("go offline")
#   -> [part 2] send 2 offline messages + kill/relaunch app (SQLite persistence)
#   -> start server ("restore network")
#   -> headless client B: author 2 offline messages as user B, connect once (sync up)
#   -> [part 3] assert device A shows all 5 messages, converged, no duplicates
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
#   - Metro running for that app (`cd apps/mobile && bun run dev`)
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

RUN_ID="${RUN_ID:-$(date +%s)}"
export RUN_ID
echo "==> RUN_ID=$RUN_ID"

# maestro picks the only booted simulator automatically; with several booted (common in
# dev) it errors asking to disambiguate — set DEVICE_UDID to be explicit.
MAESTRO_DEVICE_ARGS=()
if [ -n "${DEVICE_UDID:-}" ]; then
  MAESTRO_DEVICE_ARGS=(--device "$DEVICE_UDID")
fi

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
RUN_ID="$RUN_ID" node --experimental-strip-types "$SCRIPT_DIR/scripts/client-b-offline-inject.ts"

echo "==> [3/3] Verify convergence on device A (5 messages, no duplicates)"
maestro test "${MAESTRO_DEVICE_ARGS[@]}" "$SCRIPT_DIR/03-verify-convergence.yaml" -e RUN_ID="$RUN_ID"

echo "==> All 3 Maestro flows passed for RUN_ID=$RUN_ID"
